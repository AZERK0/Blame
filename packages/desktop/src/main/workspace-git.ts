import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix, resolve } from "node:path";
import { promisify } from "node:util";
import { withoutTelemetryEnvironment } from "@blame/telemetry";
import { pLimit } from "./concurrency.ts";

const execFileAsync = promisify(execFile);
const maxBuffer = 50 * 1024 * 1024;
const gitReadLimit = pLimit(6);

export type GitDirectoryInput = {
  path?: string;
  refs: string[];
  root: string;
};

export type GitFileInput = GitDirectoryInput & {
  path: string;
};

export type GitDiffInput = {
  from: string;
  root: string;
  to: string;
};

export type GitDiffFromInput = Omit<GitDiffInput, "to">;

export type GitSnapshotInput = {
  id: string;
  root: string;
};

export async function gitSnapshot(input: GitSnapshotInput) {
  if (!/^[0-9a-z._-]+$/i.test(input.id)) throw new Error("Invalid snapshot id");
  const directory = await mkdtemp(join(tmpdir(), "blame-git-snapshot-"));
  const index = join(directory, "index");
  const env = { GIT_INDEX_FILE: index };
  try {
    await runGit(input.root, ["read-tree", "HEAD"], env);
    const trackedEnvFiles = await trackedRuntimeEnvPaths(input.root, env);
    if (trackedEnvFiles.length) {
      await runGit(
        input.root,
        ["rm", "--cached", "--ignore-unmatch", "--", ...trackedEnvFiles],
        env,
      );
    }
    const excludedEnvFiles = await changedRuntimeEnvPathspecs(input.root);
    await runGit(
      input.root,
      ["add", "-A", "--", ".", ...excludedEnvFiles],
      env,
    );
    const { stdout } = await runGit(input.root, ["write-tree"], env);
    const ref = stdout.trim();
    await runGit(input.root, [
      "update-ref",
      `refs/blame/agent-runs/${input.id}`,
      ref,
    ]);
    return ref;
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export async function gitDiffFrom(input: GitDiffFromInput) {
  const from = revision(input.from);
  const [committedEnvFiles, changedEnvFiles] = await Promise.all([
    committedRuntimeEnvPathspecs(input.root, from, "HEAD"),
    changedRuntimeEnvPathspecs(input.root),
  ]);
  const excludedEnvFiles = [
    ...new Set([...committedEnvFiles, ...changedEnvFiles]),
  ];
  const [{ stdout }, untracked] = await Promise.all([
    runGit(input.root, [
      "diff",
      "--no-ext-diff",
      from,
      "--",
      ".",
      ...excludedEnvFiles,
    ]),
    untrackedGitDiffs(input.root),
  ]);
  return [stdout, ...untracked].filter(Boolean).join("\n");
}

export async function gitDiffBetween(input: GitDiffInput) {
  const from = revision(input.from);
  const to = revision(input.to);
  const excludedEnvFiles = await committedRuntimeEnvPathspecs(
    input.root,
    from,
    to,
  );
  const { stdout } = await runGit(input.root, [
    "diff",
    "--no-ext-diff",
    from,
    to,
    "--",
    ".",
    ...excludedEnvFiles,
  ]);
  return stdout;
}

export async function listGitDirectory(input: GitDirectoryInput) {
  const path = gitPath(input.path);
  const entries = new Map<string, GitTreeEntry>();
  const trees = await Promise.all(
    input.refs.map((ref) =>
      gitReadLimit(() => readGitTree(input.root, ref, path)),
    ),
  );
  for (const stdout of trees) {
    parseTree(stdout, path).forEach((entry) => entries.set(entry.name, entry));
  }
  return [...entries.values()].sort((left, right) =>
    `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
  );
}

export async function readGitFile(input: GitFileInput) {
  const path = gitPath(input.path);
  let lastError: unknown;
  for (const ref of input.refs) {
    try {
      const { stdout } = await runGit(input.root, [
        "show",
        `${revision(ref)}:${path}`,
      ]);
      return stdout;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function ensureGitRepository(root: string) {
  const cwd = resolve(root);
  let changed = false;

  if (!(await isGitRepository(cwd))) {
    await runGit(cwd, ["init"]);
    changed = true;
  }

  if (!(await hasGitHead(cwd))) {
    await createInitialGitCommit(cwd);
    changed = true;
  }

  return changed;
}

export async function isGitRepository(root: string) {
  const cwd = resolve(root);
  try {
    const { stdout } = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
    return resolve(stdout.trim()) === cwd;
  } catch {
    return false;
  }
}

type GitTreeEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

function parseTree(output: string, parent: string) {
  return output
    .split("\0")
    .filter(Boolean)
    .map((line) => treeEntry(line, parent));
}

function treeEntry(line: string, parent: string): GitTreeEntry {
  const [metadata, name] = line.split("\t", 2);
  const type = metadata.split(" ")[1] === "tree" ? "directory" : "file";
  return {
    name: basename(name),
    path: parent ? `${parent}/${name}` : name,
    type,
  };
}

function revision(value: string) {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})(?:\^)?$/i.test(value)) {
    throw new Error("Invalid Git revision");
  }
  return value;
}

export function runtimeEnvPath(path: string) {
  const name = basename(path);
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return ![".example", ".sample", ".template"].some((suffix) =>
    name.endsWith(suffix),
  );
}

export function excludedGitPathspec(path: string) {
  return `:!${gitPath(path)}`;
}

async function committedRuntimeEnvPathspecs(
  root: string,
  from: string,
  to: string,
) {
  const { stdout } = await runGit(root, [
    "diff",
    "--name-only",
    from,
    to,
    "--",
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .filter(runtimeEnvPath)
    .map(excludedGitPathspec);
}

async function changedRuntimeEnvPathspecs(root: string) {
  const [{ stdout: worktree }, { stdout: staged }] = await Promise.all([
    runGit(root, [
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z",
    ]),
    runGit(root, ["diff", "--cached", "--name-only", "-z", "--"]),
  ]);
  return [...new Set(`${worktree}${staged}`.split("\0"))]
    .filter(Boolean)
    .filter(runtimeEnvPath)
    .map(excludedGitPathspec);
}

async function trackedRuntimeEnvPaths(
  root: string,
  environment: Record<string, string>,
) {
  const { stdout } = await runGit(root, ["ls-files", "-z"], environment);
  return stdout.split("\0").filter(Boolean).filter(runtimeEnvPath);
}

async function untrackedGitDiffs(root: string) {
  const { stdout } = await runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const paths = stdout
    .split("\0")
    .filter(Boolean)
    .filter((path) => !runtimeEnvPath(path));
  return Promise.all(
    paths.map((path) => gitReadLimit(() => untrackedGitDiff(root, path))),
  );
}

async function untrackedGitDiff(root: string, path: string) {
  try {
    return (
      await runGit(root, [
        "diff",
        "--no-ext-diff",
        "--no-index",
        "--",
        "/dev/null",
        gitPath(path),
      ])
    ).stdout;
  } catch (error) {
    if (gitDiffOutput(error)) return gitDiffOutput(error);
    throw error;
  }
}

function gitDiffOutput(error: unknown) {
  if (!error || typeof error !== "object" || !("stdout" in error)) return "";
  return typeof error.stdout === "string" ? error.stdout : "";
}

function gitPath(value?: string) {
  const normalized = posix.normalize((value ?? "").replaceAll("\\", "/"));
  if (!normalized || normalized === ".") return "";
  if (
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/")
  ) {
    throw new Error("Path escapes workspace");
  }
  return normalized.replace(/\/$/, "");
}

function runGit(
  root: string,
  args: string[],
  environment?: Record<string, string>,
) {
  return execFileAsync("git", args, {
    cwd: root,
    env: { ...withoutTelemetryEnvironment(process.env), ...environment },
    maxBuffer,
  });
}

async function hasGitHead(cwd: string) {
  try {
    await runGit(cwd, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

async function createInitialGitCommit(cwd: string) {
  await runGit(cwd, ["add", "-A", "--", "."]);
  await runGit(cwd, [
    "-c",
    "user.name=Blame",
    "-c",
    "user.email=blame@local",
    "commit",
    "--allow-empty",
    "--no-gpg-sign",
    "--no-verify",
    "-m",
    "chore: initialize repository",
  ]);
}

async function readGitTree(root: string, ref: string, path: string) {
  const tree = path ? `${revision(ref)}:${path}` : `${revision(ref)}:`;
  try {
    return (await runGit(root, ["ls-tree", "-z", tree])).stdout;
  } catch (error) {
    if (!path) throw error;
    return "";
  }
}
