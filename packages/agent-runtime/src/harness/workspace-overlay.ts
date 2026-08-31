import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import fg from "fast-glob";
import { isBinaryFileSync } from "isbinaryfile";
import pLimit from "p-limit";
import { sha256 } from "./protocol.js";
import type { PreparedFile } from "./change-preparation.js";
import {
  assertMutableWorkspacePath,
  type WorkspaceFiles,
  type WorkspaceSnapshot,
} from "./workspace-files.js";

const maximumEffectFiles = 500;
const maximumScannedFiles = 50_000;
const maximumCapturedBytes = 10 * 1024 * 1024;
const ignoredOverlayGlobs = [
  ".blame/**",
  ".git/**",
  ".home/**",
  ".tmp/**",
  "**/node_modules/**",
];

type OverlayEntry = {
  content: Buffer | null;
  hash: string;
  mode: number;
};

type OverlaySnapshot = {
  entries: Map<string, OverlayEntry>;
  truncated: boolean;
};

export type OverlayRuntimeInputMode = "readonly" | "writable_dependencies";

export type OverlayEffects = {
  changes: PreparedFile[];
  created: string[];
  modified: string[];
  deleted: string[];
  truncated: boolean;
  uncaptured_reason?: string;
};

export class WorkspaceOverlay {
  readonly directory: string;
  readonly readonlyInputs: string[];
  readonly workspace: string;
  private readonly baseline: Map<string, OverlayEntry>;

  private constructor(
    directory: string,
    workspace: string,
    baseline: Map<string, OverlayEntry>,
    readonlyInputs: string[],
  ) {
    this.directory = directory;
    this.workspace = workspace;
    this.baseline = baseline;
    this.readonlyInputs = readonlyInputs;
  }

  static async materialize(
    files: WorkspaceFiles,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
    runtimeInputMode: OverlayRuntimeInputMode = "readonly",
  ) {
    const directory = await mkdtemp(join(tmpdir(), "blame-run-overlay-"));
    const workspace = join(directory, "workspace");
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    const limit = pLimit(16);
    try {
      await Promise.all(
        snapshot.files.map((path) =>
          limit(() => copyWorkspaceEntry(files.root, workspace, path, signal)),
        ),
      );
      const readonlyInputs = await prepareRuntimeInputs(
        files.root,
        workspace,
        snapshot.files,
        runtimeInputMode,
      );
      await Promise.all([
        mkdir(join(workspace, ".home"), { recursive: true, mode: 0o700 }),
        mkdir(join(workspace, ".tmp"), { recursive: true, mode: 0o700 }),
      ]);
      const baseline = await snapshotOverlay(workspace, signal);
      if (baseline.truncated)
        throw new Error(
          `UNSUPPORTED_CAPABILITY:Workspace contains more than ${maximumScannedFiles} auditable files.`,
        );
      return new WorkspaceOverlay(
        directory,
        workspace,
        baseline.entries,
        readonlyInputs,
      );
    } catch (error) {
      await removeOverlayDirectory(directory);
      throw error;
    }
  }

  async effects(signal?: AbortSignal): Promise<OverlayEffects> {
    const after = await snapshotOverlay(this.workspace, signal);
    const paths = [
      ...new Set([...this.baseline.keys(), ...after.entries.keys()]),
    ].sort();
    const created: string[] = [];
    const modified: string[] = [];
    const deleted: string[] = [];
    const changes: PreparedFile[] = [];
    let capturedBytes = 0;
    let truncated = after.truncated;
    let uncapturedReason = after.truncated
      ? `Run produced more than ${maximumScannedFiles} auditable files.`
      : undefined;
    for (const path of paths) {
      signal?.throwIfAborted();
      const before = this.baseline.get(path);
      const current = after.entries.get(path);
      if (before?.hash === current?.hash && before?.mode === current?.mode)
        continue;
      if (!before) created.push(path);
      else if (!current) deleted.push(path);
      else modified.push(path);
      if (
        created.length + modified.length + deleted.length >
        maximumEffectFiles
      ) {
        truncated = true;
        uncapturedReason = `Run changed more than ${maximumEffectFiles} files.`;
        continue;
      }
      try {
        assertMutableWorkspacePath(path);
      } catch {
        uncapturedReason = "Run changed a protected metadata or secret path.";
        continue;
      }
      if (before?.content === null || current?.content === null) {
        uncapturedReason =
          "Run changed a file larger than the 10 MiB proposal capture limit.";
        continue;
      }
      capturedBytes +=
        (before?.content.byteLength ?? 0) + (current?.content.byteLength ?? 0);
      if (capturedBytes > maximumCapturedBytes) {
        uncapturedReason = "Run effects exceed the 10 MiB capture limit.";
        continue;
      }
      changes.push({
        path,
        oldContent: before?.content ?? null,
        newContent: current?.content ?? null,
        oldHash: before?.hash ?? null,
        newHash: current?.hash ?? null,
        oldMode: before?.mode ?? null,
        newMode: current?.mode ?? null,
        binary:
          (before?.content ? isBinaryFileSync(before.content) : false) ||
          (current?.content ? isBinaryFileSync(current.content) : false),
      });
    }
    if (uncapturedReason) changes.length = 0;
    return {
      changes,
      created: created.slice(0, maximumEffectFiles),
      modified: modified.slice(0, maximumEffectFiles),
      deleted: deleted.slice(0, maximumEffectFiles),
      truncated,
      ...(uncapturedReason ? { uncaptured_reason: uncapturedReason } : {}),
    };
  }

  cleanup() {
    return removeOverlayDirectory(this.directory);
  }
}

function removeOverlayDirectory(directory: string) {
  return rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 8,
    retryDelay: 100,
  });
}

async function copyWorkspaceEntry(
  sourceRoot: string,
  destinationRoot: string,
  path: string,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const source = join(sourceRoot, path);
  const destination = join(destinationRoot, path);
  const info = await lstat(source);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  if (info.isSymbolicLink()) {
    const target = await readlink(source);
    assertSafeSymlink(sourceRoot, source, target);
    await symlink(target, destination);
    return;
  }
  if (!info.isFile()) return;
  await copyFile(source, destination, constants.COPYFILE_FICLONE);
  await chmod(destination, info.mode & 0o777);
}

async function prepareRuntimeInputs(
  sourceRoot: string,
  destinationRoot: string,
  sourceFiles: string[],
  mode: OverlayRuntimeInputMode,
) {
  const readonlyInputs: string[] = [];
  const packageDirectories = packageManifestDirectories(sourceFiles);
  for (const directory of packageDirectories) {
    const source = join(sourceRoot, directory, "node_modules");
    const destination = join(destinationRoot, directory, "node_modules");
    if (mode === "writable_dependencies") {
      await mkdir(destination, { recursive: true, mode: 0o700 });
      continue;
    }
    try {
      if (!(await lstat(source)).isDirectory()) continue;
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
      await symlink(source, destination, "dir");
      readonlyInputs.push(source);
    } catch (error) {
      if (errorCode(error) !== "ENOENT") throw error;
    }
  }
  return readonlyInputs;
}

function packageManifestDirectories(sourceFiles: string[]) {
  const directories = new Set<string>(["."]);
  for (const path of sourceFiles) {
    if (path === "package.json" || path.endsWith("/package.json"))
      directories.add(dirname(path));
  }
  return directories;
}

async function snapshotOverlay(root: string, signal?: AbortSignal) {
  const matches = await fg("**/*", {
    cwd: root,
    dot: true,
    followSymbolicLinks: false,
    ignore: ignoredOverlayGlobs,
    onlyFiles: true,
    unique: true,
  });
  const sorted = matches.sort();
  const truncated = sorted.length > maximumScannedFiles;
  const paths = sorted.slice(0, maximumScannedFiles);
  const entries = new Map<string, OverlayEntry>();
  const limit = pLimit(16);
  await Promise.all(
    paths.map((path) =>
      limit(async () => {
        signal?.throwIfAborted();
        const absolute = join(root, path);
        const info = await lstat(absolute);
        if (!info.isFile()) return;
        const content =
          info.size <= maximumCapturedBytes ? await readFile(absolute) : null;
        entries.set(path.replaceAll("\\", "/"), {
          content,
          hash: content ? sha256(content) : await hashFile(absolute),
          mode: info.mode & 0o777,
        });
      }),
    ),
  );
  return { entries, truncated } satisfies OverlaySnapshot;
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

function assertSafeSymlink(root: string, path: string, target: string) {
  if (!target || isAbsolute(target))
    throw new Error(`Workspace symlink ${path} is not overlay-safe.`);
  const resolved = resolve(dirname(path), target);
  const local = relative(root, resolved);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
    throw new Error(`Workspace symlink ${path} escapes the workspace.`);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
