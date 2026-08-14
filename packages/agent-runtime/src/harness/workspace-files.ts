import { execFile } from "node:child_process";
import {
  lstat,
  readFile,
  readdir,
  readlink,
  realpath,
  stat,
} from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { FileRef, SourceRevisionRef } from "./protocol.js";
import { encodeHandle, sha256 } from "./protocol.js";

const execFileAsync = promisify(execFile);
const ignoredDirectories = new Set([
  ".blame",
  ".code-review-graph",
  ".git",
  ".next",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
]);
const maxWorkspaceFiles = 50_000;

export type WorkspaceChange = {
  path: string;
  status: "added" | "deleted" | "modified";
};

export type WorkspaceSnapshot = {
  branch?: string;
  changes: WorkspaceChange[];
  files: string[];
  git: boolean;
  revision: SourceRevisionRef;
};

export class WorkspaceFiles {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async snapshot(signal?: AbortSignal): Promise<WorkspaceSnapshot> {
    signal?.throwIfAborted();
    const git = await this.isGitRepository();
    const baseCommit = git
      ? await this.gitOptional(["rev-parse", "HEAD"], signal)
      : undefined;
    const files = git
      ? await this.gitFiles(signal)
      : await this.walkFiles(this.root, signal);
    const changedPaths = git
      ? await this.gitChangedPaths(Boolean(baseCommit), signal)
      : files;
    const entries: string[] = [];
    const changes: WorkspaceChange[] = [];
    for (const path of changedPaths.sort()) {
      signal?.throwIfAborted();
      const state = await this.pathState(path);
      entries.push(`${path}\0${state.digest}\0${state.kind}`);
      changes.push({
        path,
        status:
          state.kind === "gone" ? "deleted" : baseCommit ? "modified" : "added",
      });
    }
    if (git) {
      const untracked = new Set(
        nulList(
          await this.git(
            ["ls-files", "--others", "--exclude-standard", "-z"],
            signal,
          ),
        ).filter(isHarnessSourcePath),
      );
      for (const change of changes) {
        if (untracked.has(change.path)) change.status = "added";
      }
    }
    const overlayMerkleRoot = sha256(entries.join("\n"));
    const sourceRevisionId = `src_${sha256(
      `${baseCommit ?? "no-git"}\0${overlayMerkleRoot}`,
    ).slice(0, 32)}`;
    const branch = git
      ? await this.gitOptional(["branch", "--show-current"], signal)
      : undefined;
    return {
      ...(branch ? { branch } : {}),
      changes,
      files,
      git,
      revision: {
        source_revision_id: sourceRevisionId,
        ...(baseCommit ? { base_commit: baseCommit } : {}),
        overlay_merkle_root: overlayMerkleRoot,
      },
    };
  }

  async read(path: string) {
    const absolute = await this.resolveExisting(path);
    const info = await stat(absolute);
    const content = await readFile(absolute);
    return {
      absolute,
      content,
      mode: info.mode & 0o777,
      path: this.normalizePath(path),
    };
  }

  async blobHash(path: string) {
    return sha256((await this.read(path)).content);
  }

  async fileRef(
    path: string,
    revision: string,
    observedContent?: Buffer,
  ): Promise<FileRef> {
    const normalized = this.normalizePath(path);
    const content = observedContent ?? (await this.read(normalized)).content;
    const digest = sha256(content);
    return {
      ref: encodeHandle("file", {
        version: 1,
        revision,
        path: normalized,
        start: 0,
        end: content.byteLength,
        digest,
      }),
      source_revision_id: revision,
      path: normalized,
      blob_hash: digest,
    };
  }

  resolveForWrite(path: string) {
    const normalized = this.normalizePath(path);
    assertMutableWorkspacePath(normalized);
    return { absolute: resolve(this.root, normalized), path: normalized };
  }

  async resolveForWriteVerified(path: string) {
    const target = this.resolveForWrite(path);
    const root = await realpath(this.root);
    let ancestor = target.absolute;
    while (ancestor !== this.root) {
      try {
        const resolvedAncestor = await realpath(ancestor);
        const local = relative(root, resolvedAncestor);
        if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
          throw new Error("Write target resolves outside the workspace root.");
        return target;
      } catch (error) {
        if (errorCode(error) !== "ENOENT") throw error;
        ancestor = resolve(ancestor, "..");
      }
    }
    return target;
  }

  normalizePath(path: string) {
    if (typeof path !== "string" || !path.trim() || path.includes("\0"))
      throw new Error("A non-empty workspace-relative path is required.");
    const portable = path.replaceAll("\\", "/").replace(/^\.\//, "");
    if (isAbsolute(portable))
      throw new Error("Absolute paths are not allowed.");
    const absolute = resolve(this.root, portable);
    const local = relative(this.root, absolute);
    if (!local || local === ".") return ".";
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
      throw new Error("Path escapes the workspace root.");
    return local.split(sep).join("/");
  }

  private async resolveExisting(path: string) {
    const normalized = this.normalizePath(path);
    const candidate = resolve(this.root, normalized);
    if ((await lstat(candidate)).isSymbolicLink())
      throw new Error(
        "Symbolic-link files are not supported by exact harness reads.",
      );
    const resolved = await realpath(candidate);
    const local = relative(await realpath(this.root), resolved);
    if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local))
      throw new Error("Resolved path escapes the workspace root.");
    const info = await stat(resolved);
    if (!info.isFile()) throw new Error("Target is not a regular file.");
    return resolved;
  }

  private async pathState(path: string) {
    try {
      const absolute = resolve(this.root, path);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) {
        const target = await readlink(absolute);
        return { digest: sha256(target), kind: "symlink" as const };
      }
      if (!info.isFile())
        return { digest: sha256("non-file"), kind: "other" as const };
      return {
        digest: sha256(
          Buffer.concat([
            Buffer.from(`${info.mode & 0o777}\0`),
            await readFile(absolute),
          ]),
        ),
        kind: "file" as const,
      };
    } catch (error) {
      if (errorCode(error) === "ENOENT")
        return { digest: sha256("gone"), kind: "gone" as const };
      throw error;
    }
  }

  private async isGitRepository() {
    return Boolean(await this.gitOptional(["rev-parse", "--show-toplevel"]));
  }

  private async gitFiles(signal?: AbortSignal) {
    const output = await this.git(
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      signal,
    );
    return unique(nulList(output).filter(isHarnessSourcePath)).slice(
      0,
      maxWorkspaceFiles,
    );
  }

  private async gitChangedPaths(hasHead: boolean, signal?: AbortSignal) {
    const tracked = hasHead
      ? nulList(
          await this.git(["diff", "--name-only", "-z", "HEAD", "--"], signal),
        )
      : nulList(await this.git(["ls-files", "--cached", "-z"], signal));
    const untracked = nulList(
      await this.git(
        ["ls-files", "--others", "--exclude-standard", "-z"],
        signal,
      ),
    );
    return unique([...tracked, ...untracked].filter(isHarnessSourcePath));
  }

  private async walkFiles(
    directory: string,
    signal?: AbortSignal,
  ): Promise<string[]> {
    const files: string[] = [];
    const visit = async (current: string) => {
      signal?.throwIfAborted();
      if (files.length >= maxWorkspaceFiles) return;
      for (const entry of await readdir(current, { withFileTypes: true })) {
        if (ignoredDirectories.has(entry.name)) continue;
        const absolute = resolve(current, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile())
          files.push(relative(this.root, absolute).split(sep).join("/"));
      }
    };
    await visit(directory);
    return files.sort();
  }

  private async git(args: string[], signal?: AbortSignal) {
    const { stdout } = await execFileAsync("git", args, {
      cwd: this.root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      signal,
    });
    return stdout;
  }

  private async gitOptional(args: string[], signal?: AbortSignal) {
    try {
      return (await this.git(args, signal)).trim() || undefined;
    } catch {
      return undefined;
    }
  }
}

export function languageName(path: string) {
  return languageByExtension[extname(path).toLowerCase()] ?? "unknown";
}

function isHarnessSourcePath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/");
  const first = segments[0];
  const basename = segments.at(-1)?.toLowerCase() ?? "";
  return (
    Boolean(path) &&
    !ignoredDirectories.has(first) &&
    !segments.includes(".ssh") &&
    !(basename.startsWith(".env") && basename !== ".env.example") &&
    ![".npmrc", "id_rsa", "id_ed25519", "known_hosts"].includes(basename)
  );
}

export function assertMutableWorkspacePath(path: string) {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  if (
    segments.includes(".blame") ||
    segments.includes(".code-review-graph") ||
    segments.includes(".git") ||
    segments.includes(".ssh") ||
    (basename.startsWith(".env") && basename !== ".env.example") ||
    [".npmrc", "id_rsa", "id_ed25519", "known_hosts"].includes(basename)
  )
    throw new Error("Harness policy protects metadata and secret paths.");
}

function nulList(output: string) {
  return output.split("\0").filter(Boolean);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}

const languageByExtension: Record<string, string> = {
  ".cjs": "javascript",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescript",
};
