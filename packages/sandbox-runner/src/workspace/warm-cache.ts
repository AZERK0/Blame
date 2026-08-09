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
  "out",
]);

export async function refreshWorkspacePreservingWarmCaches<T>(
  refresh: () => Promise<T>,
  root: string = runtimePaths.workspace,
) {
  const cachePaths = await warmCacheDirectories(root);
  if (!cachePaths.length) {
    return { cachePaths, result: await refresh() };
  }
  const storage = await mkdtemp(join(tmpdir(), "blame-warm-cache-"));
  const storedPaths = new Set<string>();
  try {
    for (const path of cachePaths) {
      const source = join(root, path);
      const target = join(storage, path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await rename(source, target);
      storedPaths.add(path);
    }
    const result = await refresh();
    await restoreStoredPaths(root, storage, storedPaths);
    return { cachePaths, result };
  } catch (error) {
    await restoreStoredPaths(root, storage, storedPaths).catch(() => undefined);
    throw error;
  } finally {
    if (!storedPaths.size) {
      await rm(storage, { recursive: true, force: true });
    }
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
    if (entry.name === "node_modules") {
      paths.push(path);
      continue;
    }
    if (entry.name === ".next") {
      const nextCache = join(absolute, "cache");
      const cache = await lstat(nextCache).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return undefined;
          throw error;
        },
      );
      if (cache?.isDirectory() && !cache.isSymbolicLink()) {
        paths.push(`${path}/cache`);
      }
      continue;
    }
    if (cacheDirectoryNames.has(entry.name)) {
      paths.push(path);
      continue;
    }
    if (skippedDirectoryNames.has(entry.name)) continue;
    if (path === ".blame/runtime-tools") continue;
    await visit(root, absolute, paths);
  }
}

async function restoreStoredPaths(
  root: string,
  storage: string,
  storedPaths: Set<string>,
) {
  for (const path of [...storedPaths]) {
    await assertSafeCacheDestination(root, path);
    const source = join(storage, path);
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await rm(target, { recursive: true, force: true });
    await rename(source, target);
    storedPaths.delete(path);
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
