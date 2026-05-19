import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { BrowserWindow, ipcMain } from "electron";

const execFileAsync = promisify(execFile);

type WorkspacePathInput = {
  root: string;
  path?: string;
};

type WorkspaceSearchInput = WorkspacePathInput & {
  query: string;
  limit?: number;
};

type CreateWorktreeInput = {
  repositoryRoot: string;
  storyId: number;
  title: string;
};

type RunProjectSetupInput = {
  worktree: string;
  setupScript: string;
  dockerCompose: string;
};

type StopProjectSetupInput = {
  worktree: string;
};

type RemoveWorktreeInput = {
  repositoryRoot: string;
  worktree: string;
};

type SetupRun = {
  id: string;
  process: ChildProcessWithoutNullStreams;
};

const setupRuns = new Map<string, SetupRun>();

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
  ipcMain.handle("workspace:create-worktree", (_event, input: CreateWorktreeInput) =>
    createWorktree(input),
  );
  ipcMain.handle("workspace:run-project-setup", (_event, input: RunProjectSetupInput) =>
    runProjectSetup(input),
  );
  ipcMain.handle("workspace:stop-project-setup", (_event, input: StopProjectSetupInput) =>
    stopProjectSetup(input),
  );
  ipcMain.handle("workspace:remove-worktree", (_event, input: RemoveWorktreeInput) =>
    removeWorktree(input),
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

async function createWorktree(input: CreateWorktreeInput) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const repositoryName = basename(repositoryRoot);
  const slug = storySlug(input.storyId, input.title);
  const branch = `blame/story-${input.storyId}-${slug}`;
  const worktree = resolve(
    dirname(repositoryRoot),
    ".blame-worktrees",
    repositoryName,
    `story-${input.storyId}-${slug}`,
  );

  await assertGitRepository(repositoryRoot);
  await mkdir(dirname(worktree), { recursive: true });

  if (await worktreeRegistered(repositoryRoot, worktree)) {
    return { worktree, branch };
  }

  if (existsSync(worktree)) {
    throw new Error("Worktree directory already exists but is not registered");
  }

  if (await branchExists(repositoryRoot, branch)) {
    await execFileAsync("git", ["worktree", "add", worktree, branch], {
      cwd: repositoryRoot,
    });
    return { worktree, branch };
  }

  await execFileAsync("git", ["worktree", "add", "-b", branch, worktree, "HEAD"], {
    cwd: repositoryRoot,
  });
  return { worktree, branch };
}

async function runProjectSetup(input: RunProjectSetupInput) {
  const worktree = resolve(input.worktree);
  await assertGitRepository(worktree);
  const directory = join(worktree, ".blame", "initialization");
  const scriptPath = join(directory, "setup.sh");
  const composePath = join(directory, "docker-compose.yml");

  await mkdir(directory, { recursive: true });
  await writeFile(scriptPath, input.setupScript, "utf8");
  await writeFile(composePath, input.dockerCompose, "utf8");
  await chmod(scriptPath, 0o755);

  const runId = randomUUID();
  const child = spawn("bash", [scriptPath], {
    cwd: worktree,
    env: setupEnvironment(worktree),
  });
  setupRuns.set(runId, { id: runId, process: child });

  child.stdout.on("data", (data: Buffer) =>
    emitSetupEvent(runId, "stdout", data.toString()),
  );
  child.stderr.on("data", (data: Buffer) =>
    emitSetupEvent(runId, "stderr", data.toString()),
  );
  child.on("exit", (code) => {
    setupRuns.delete(runId);
    emitSetupEvent(runId, "exit", String(code ?? ""));
  });

  return { runId };
}

async function stopProjectSetup(input: StopProjectSetupInput) {
  const worktree = resolve(input.worktree);
  const composePath = join(worktree, ".blame", "initialization", "docker-compose.yml");
  if (!existsSync(composePath)) return false;
  await execFileAsync(
    "docker",
    ["compose", "-f", composePath, "down", "--remove-orphans"],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  return true;
}

async function removeWorktree(input: RemoveWorktreeInput) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const worktree = resolve(input.worktree);
  await assertGitRepository(repositoryRoot);
  if (!(await worktreeRegistered(repositoryRoot, worktree))) return false;
  await execFileAsync("git", ["worktree", "remove", "--force", worktree], {
    cwd: repositoryRoot,
  });
  return true;
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

async function assertGitRepository(cwd: string) {
  await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
}

async function branchExists(cwd: string, branch: string) {
  try {
    await execFileAsync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd },
    );
    return true;
  } catch {
    return false;
  }
}

async function worktreeRegistered(cwd: string, worktree: string) {
  const { stdout } = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd },
  );
  return stdout
    .split("\n")
    .some((line) => line.trim() === `worktree ${worktree}`);
}

function storySlug(storyId: number, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `story-${storyId}`;
}

function setupEnvironment(worktree: string) {
  return {
    ...process.env,
    BLAME_DOCKER_COMPOSE_FILE: join(
      worktree,
      ".blame",
      "initialization",
      "docker-compose.yml",
    ),
    BLAME_INITIALIZATION_DIR: join(worktree, ".blame", "initialization"),
    COMPOSE_PROJECT_NAME: `blame_${createHash("sha1")
      .update(worktree)
      .digest("hex")
      .slice(0, 12)}`,
  };
}

function emitSetupEvent(
  runId: string,
  type: "stdout" | "stderr" | "exit",
  data: string,
) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(`workspace:setup:event:${runId}`, {
      runId,
      type,
      data,
    });
  });
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
