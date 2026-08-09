import { lstat, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { runtimePaths } from "../runtime-paths.js";

const cacheDirectoryNames = new Set([
  ".cache",
  ".next",
  ".parcel-cache",
  ".turbo",
  ".vite",
]);
const skippedDirectoryNames = new Set([
  ".git",
  ".ssh",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);

export async function refreshWorkspacePreservingWarmCaches(
  refresh: () => Promise<void>,
  root: string = runtimePaths.workspace,
) {
  const cachePaths = await warmCacheDirectories(root);
  if (!cachePaths.length) {
    await refresh();
    return [];
  }
  const storage = await mkdtemp(join(tmpdir(), "blame-warm-cache-"));
  try {
    for (const path of cachePaths) {
      const source = join(root, path);
      const target = join(storage, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(source, target);
    }
    await refresh();
    for (const path of cachePaths) {
      await assertSafeCacheDestination(root, path);
      const source = join(storage, path);
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rm(target, { recursive: true, force: true });
      await rename(source, target);
    }
    return cachePaths;
  } finally {
    await rm(storage, { recursive: true, force: true });
  }
}

export async function warmCacheDirectories(
  root: string = runtimePaths.workspace,
) {
  const paths: string[] = [];
  await visit(root, root, paths);
  return paths.sort((left, right) => left.localeCompare(right));
}

async function visit(root: string, directory: string, paths: string[]) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
    const absolute = join(directory, entry.name);
    const path = relative(root, absolute).split(sep).join("/");
    if (cacheDirectoryNames.has(entry.name)) {
      paths.push(path);
      continue;
    }
    if (skippedDirectoryNames.has(entry.name)) continue;
    if (path === ".blame/runtime-tools") continue;
    await visit(root, absolute, paths);
  }
}

async function assertSafeCacheDestination(root: string, path: string) {
  const segments = path.split("/");
  if (
    !segments.length ||
    segments.some((segment) => !segment || segment === "..")
  ) {
    throw new Error("Warm cache path is invalid.");
  }
  let current = root;
  for (const segment of segments.slice(0, -1)) {
    current = join(current, segment);
    const stat = await lstat(current).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    if (stat?.isSymbolicLink()) {
      throw new Error("Warm cache destination crosses a symlink.");
    }
  }
}
