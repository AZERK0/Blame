import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { runtimePaths } from "../runtime-paths.js";

export type WorkspaceFileSnapshot = {
  type: "file" | "symlink";
  sha256: string;
  mode: number;
  size: number;
  target?: string;
};

export type WorkspaceSnapshot = {
  hash: string;
  files: Record<string, WorkspaceFileSnapshot>;
};

export async function snapshotWorkspace(root = runtimePaths.workspace): Promise<WorkspaceSnapshot> {
  const files: Record<string, WorkspaceFileSnapshot> = {};
  const casePaths = new Map<string, string>();
  await visit(root, root, files, casePaths);
  const hash = createHash("sha256");
  for (const [path, metadata] of Object.entries(files).sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(path).update("\0").update(JSON.stringify(metadata)).update("\0");
  }
  return { hash: hash.digest("hex"), files };
}

async function visit(
  root: string,
  directory: string,
  files: Record<string, WorkspaceFileSnapshot>,
  casePaths: Map<string, string>,
) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (path === ".git" || path.startsWith(".git/") || ignored(path)) continue;
    const folded = path.normalize("NFC").toLocaleLowerCase("en-US");
    const collision = casePaths.get(folded);
    if (collision && collision !== path) {
      throw new Error(`Workspace paths collide by case: ${collision} and ${path}.`);
    }
    casePaths.set(folded, path);
    const stat = await lstat(absolute);
    if (stat.isDirectory()) {
      await visit(root, absolute, files, casePaths);
    } else if (stat.isSymbolicLink()) {
      const target = await readlink(absolute);
      assertSafeSymlink(path, target);
      files[path] = {
        type: "symlink",
        sha256: createHash("sha256").update(target).digest("hex"),
        mode: stat.mode & 0o777,
        size: Buffer.byteLength(target),
        target,
      };
    } else if (stat.isFile()) {
      const content = await readFile(absolute);
      files[path] = {
        type: "file",
        sha256: createHash("sha256").update(content).digest("hex"),
        mode: stat.mode & 0o777,
        size: stat.size,
      };
    }
  }
}

export function forbiddenWorkspacePath(path: string) {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? "";
  return (
    segments.includes(".ssh") ||
    segments.includes("node_modules") ||
    segments.includes(".next") ||
    segments.includes("dist") ||
    segments.includes("coverage") ||
    (basename.startsWith(".env") && basename !== ".env.example") ||
    [".npmrc", "id_rsa", "id_ed25519", "known_hosts"].includes(basename) ||
    normalized === ".docker/config.json" ||
    normalized.endsWith(".log")
  );
}

function ignored(path: string) {
  return forbiddenWorkspacePath(path);
}

export function assertSafeSymlink(path: string, target: string) {
  if (!target || target.startsWith("/") || /^[a-z]:/i.test(target)) {
    throw new Error(`Unsafe workspace symlink: ${path}.`);
  }
  const stack = path.split("/").slice(0, -1);
  for (const segment of target.replaceAll("\\", "/").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!stack.length) throw new Error(`Workspace symlink escapes workspace: ${path}.`);
      stack.pop();
    } else stack.push(segment);
  }
}
