import { execFile } from "node:child_process";
import { basename, posix } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const maxBuffer = 50 * 1024 * 1024;

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

export async function gitDiffBetween(input: GitDiffInput) {
  const { stdout } = await runGit(input.root, [
    "diff",
    "--no-ext-diff",
    revision(input.from),
    revision(input.to),
    "--",
  ]);
  return stdout;
}

export async function listGitDirectory(input: GitDirectoryInput) {
  const path = gitPath(input.path);
  const entries = new Map<string, GitTreeEntry>();
  for (const ref of input.refs) {
    const stdout = await readGitTree(input.root, ref, path);
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
  if (!/^[0-9a-f]{40}(?:\^)?$/i.test(value)) {
    throw new Error("Invalid Git revision");
  }
  return value;
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

function runGit(root: string, args: string[]) {
  return execFileAsync("git", args, { cwd: root, maxBuffer });
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
