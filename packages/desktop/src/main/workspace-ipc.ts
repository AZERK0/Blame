import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { ipcMain } from "electron";

const execFileAsync = promisify(execFile);

type WorkspacePathInput = {
  root: string;
  path?: string;
};

type WorkspaceSearchInput = WorkspacePathInput & {
  query: string;
  limit?: number;
};

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle(
    "workspace:list-directory",
    (_event, input: WorkspacePathInput) => listDirectory(input),
  );
  ipcMain.handle("workspace:read-file", (_event, input: WorkspacePathInput) =>
    readWorkspaceFile(input),
  );
  ipcMain.handle(
    "workspace:search-files",
    (_event, input: WorkspaceSearchInput) => searchFiles(input),
  );
  ipcMain.handle("workspace:git-diff", (_event, input: { root: string }) =>
    gitDiff(input.root),
  );
  ipcMain.handle(
    "workspace:git-repository-fingerprint",
    (_event, input: { root: string }) => gitRepositoryFingerprint(input.root),
  );
}

async function listDirectory(input: WorkspacePathInput) {
  const directory = resolveWorkspacePath(input);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => ({
      name: entry.name,
      path: toWorkspacePath(input.root, resolve(directory, entry.name)),
      type: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) =>
      `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
    );
}

async function readWorkspaceFile(input: WorkspacePathInput) {
  const filePath = resolveWorkspacePath(input);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Path is not a file");
  return readFile(filePath, "utf8");
}

async function searchFiles(input: WorkspaceSearchInput) {
  const root = resolve(input.root);
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.min(input.limit ?? 30, 100);
  const matches: Array<{ name: string; path: string; type: "file" }> = [];
  await walk(root, root, query, limit, matches);
  return matches;
}

async function gitDiff(root: string) {
  const cwd = resolve(root);
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--no-ext-diff", "--"],
    { cwd },
  );
  return stdout;
}

async function gitRepositoryFingerprint(root: string) {
  const cwd = resolve(root);
  const remoteUrls = await gitRemoteUrls(cwd);
  if (remoteUrls.length > 0) {
    return fingerprintValue(["remotes", ...remoteUrls]);
  }

  const rootCommits = await gitRootCommits(cwd);
  if (rootCommits.length > 0) {
    return fingerprintValue(["root-commits", ...rootCommits]);
  }

  return null;
}

async function walk(
  root: string,
  directory: string,
  query: string,
  limit: number,
  matches: Array<{ name: string; path: string; type: "file" }>,
) {
  if (matches.length >= limit) return;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (matches.length >= limit || shouldSkip(entry.name)) continue;
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, entryPath, query, limit, matches);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().includes(query)) {
      matches.push({
        name: entry.name,
        path: toWorkspacePath(root, entryPath),
        type: "file",
      });
    }
  }
}

function resolveWorkspacePath(input: WorkspacePathInput) {
  const root = resolve(input.root);
  const target = resolve(root, input.path ?? ".");
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error("Path escapes workspace");
  return target;
}

function toWorkspacePath(root: string, target: string) {
  const path = relative(resolve(root), target);
  return path || ".";
}

function shouldSkip(name: string) {
  return [".git", "node_modules", "dist", "build", ".turbo"].includes(name);
}

async function gitRemoteUrls(cwd: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get-regexp", "^remote\\..*\\.url$"],
      { cwd },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/, 2)[1])
      .filter(Boolean)
      .map(normalizeGitRemoteUrl)
      .sort();
  } catch {
    return [];
  }
}

async function gitRootCommits(cwd: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function normalizeGitRemoteUrl(value: string) {
  const trimmed = value.trim().replace(/\.git$/, "");
  const sshMatch = trimmed.match(/^([^@]+@[^:]+):(.+)$/);
  if (sshMatch) {
    return `ssh://${sshMatch[1]}/${sshMatch[2]}`.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function fingerprintValue(parts: string[]) {
  return `git:${createHash("sha256").update(parts.join("\n")).digest("hex")}`;
}
