import { createHash } from "node:crypto";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { extract } from "tar-stream";
import {
  chmod,
  chown,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join, normalize } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import type { SourceArtifact } from "@blame/preview-runtime";
import { runtimePaths } from "../runtime-paths.js";
import { initializeChangeJournal } from "./change-journal.js";
import { runnerError } from "../protocol/runner-server.js";

type SourceManifest = {
  version: 1;
  baseCommit: string;
  workspaceHash: string;
  files: Record<string, {
    type: "file" | "symlink";
    sha256: string;
    mode: number;
    size: number;
    target?: string;
  }>;
};

export async function importSourceArtifact(source: SourceArtifact) {
  if (!source.downloadUrl) throw runnerError("SOURCE_URL_MISSING", "Source download URL is missing.");
  if (!Number.isSafeInteger(source.size) || source.size < 1 || source.size > 256 * 1024 * 1024) {
    throw runnerError("SOURCE_SIZE_INVALID", "Source size is outside the permitted range.");
  }
  if (!/^[a-f0-9]{64}$/i.test(source.sha256)) {
    throw runnerError("SOURCE_HASH_INVALID", "Source checksum is invalid.");
  }
  const url = validatedHttpsUrl(source.downloadUrl);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok || !response.body) {
    throw runnerError("SOURCE_DOWNLOAD_FAILED", "Unable to download source artifact.");
  }
  const content = await readBoundedResponse(response.body, source.size);
  if (createHash("sha256").update(content).digest("hex") !== source.sha256) {
    throw runnerError("SOURCE_HASH_MISMATCH", "Source checksum mismatch.");
  }
  const staging = await mkdtemp(join(tmpdir(), "blame-source-"));
  try {
    await extractArchive(content, staging);
    const manifest = JSON.parse(
      await readFile(join(staging, ".blame/source-manifest.json"), "utf8"),
    ) as SourceManifest;
    validateManifest(manifest);
    await reconstructWorkspace(staging, manifest);
    const journal = await initializeChangeJournal();
    if (journal.current.hash !== manifest.workspaceHash) {
      throw runnerError("SOURCE_RECONSTRUCTION_MISMATCH", "Reconstructed workspace hash mismatch.");
    }
    return { sourceRevision: source.revision, workspaceHash: journal.current.hash };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function readBoundedResponse(stream: ReadableStream<Uint8Array>, expectedSize: number) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > expectedSize) {
        await reader.cancel("Source artifact exceeded its declared size");
        throw runnerError("SOURCE_SIZE_MISMATCH", "Source size mismatch.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (received !== expectedSize) {
    throw runnerError("SOURCE_SIZE_MISMATCH", "Source size mismatch.");
  }
  const content = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return content;
}

async function extractArchive(content: Uint8Array, root: string) {
  const parser = extract();
  let entries = 0;
  let expandedBytes = 0;
  const maximumEntryBytes = 256 * 1024 * 1024;
  const maximumExpandedBytes = 2 * 1024 * 1024 * 1024;
  const completion = new Promise<void>((resolve, reject) => {
    parser.on("entry", async (header, stream, next) => {
      try {
        entries += 1;
        if (entries > 25_000) throw new Error("Archive entry limit exceeded.");
        const portablePath = safePortablePath(header.name);
        assertAllowedArchivePath(portablePath);
        const path = safePath(root, portablePath);
        if (header.type === "directory") await mkdir(path, { recursive: true, mode: 0o700 });
        else if (header.type === "file") {
          if ((header.size ?? 0) > maximumEntryBytes) throw new Error("Archive entry is too large.");
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          const chunks: Buffer[] = [];
          let entryBytes = 0;
          for await (const chunk of stream) {
            entryBytes += Buffer.byteLength(chunk);
            expandedBytes += Buffer.byteLength(chunk);
            if (entryBytes > maximumEntryBytes || expandedBytes > maximumExpandedBytes) {
              throw new Error("Archive expanded size limit exceeded.");
            }
            chunks.push(Buffer.from(chunk));
          }
          await writeFile(path, Buffer.concat(chunks), { mode: (header.mode ?? 0o600) & 0o777 });
          next();
          return;
        } else if (header.type === "symlink") {
          await mkdir(dirname(path), { recursive: true, mode: 0o700 });
          assertSymlink(root, path, header.linkname ?? "");
          await symlink(header.linkname!, path);
        } else throw new Error("Unsupported archive entry type.");
        stream.resume();
        stream.once("end", next);
      } catch (error) {
        stream.resume();
        reject(error);
      }
    });
    parser.once("finish", resolve);
    parser.once("error", reject);
  });
  const readable = Readable.from(Buffer.from(content));
  if (content[0] === 0x1f && content[1] === 0x8b) readable.pipe(createGunzip()).pipe(parser);
  else readable.pipe(parser);
  await completion;
}

async function reconstructWorkspace(staging: string, manifest: SourceManifest) {
  const bundle = join(staging, ".blame/repository.bundle");
  const next = `${runtimePaths.workspace}.next-${process.pid}`;
  const backup = `${runtimePaths.workspace}.previous-${process.pid}`;
  await rm(next, { recursive: true, force: true });
  await git(["clone", "--no-hardlinks", bundle, next]);
  await pruneClone(next, new Set(Object.keys(manifest.files)));
  const overlay = join(staging, "workspace");
  try {
    if ((await lstat(overlay)).isDirectory()) await cp(overlay, next, { recursive: true, force: true, dereference: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await makeGitReadonly(join(next, ".git"));
  const identity = await projectIdentity();
  await recursiveChown(next, identity.uid, identity.gid);
  await rm(backup, { recursive: true, force: true });
  try {
    await rename(runtimePaths.workspace, backup);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await rename(next, runtimePaths.workspace);
  await rm(backup, { recursive: true, force: true });
}

async function pruneClone(root: string, allowed: Set<string>, directory = root) {
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (directory === root && entry.name === ".git") continue;
    const absolute = join(directory, entry.name);
    const relative = absolute.slice(root.length + 1).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await pruneClone(root, allowed, absolute);
      if (!(await readdir(absolute)).length) await rm(absolute, { recursive: true, force: true });
    } else if (!allowed.has(relative)) await rm(absolute, { force: true });
  }
}

async function makeGitReadonly(path: string) {
  for (const entry of await import("node:fs/promises").then(({ readdir }) =>
    readdir(path, { withFileTypes: true }),
  )) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await makeGitReadonly(child);
    else await chmod(child, 0o444);
  }
  await chmod(path, 0o555);
}

async function recursiveChown(path: string, uid: number, gid: number) {
  const stat = await lstat(path);
  if (!path.includes("/.git") && !path.endsWith("/.git")) await chown(path, uid, gid);
  if (!stat.isDirectory()) return;
  for (const entry of await import("node:fs/promises").then(({ readdir }) => readdir(path))) {
    await recursiveChown(join(path, entry), uid, gid);
  }
}

function safePath(root: string, value: string) {
  const portable = safePortablePath(value);
  const normalized = normalize(portable);
  const path = join(root, normalized);
  if (!path.startsWith(`${root}/`)) throw new Error("Archive path escapes staging.");
  return path;
}

function safePortablePath(value: string) {
  const portable = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !portable ||
    portable.startsWith("/") ||
    /^[a-z]:/i.test(portable) ||
    portable.includes("\0") ||
    portable.split("/").some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("Archive path traversal rejected.");
  }
  return portable;
}

function assertAllowedArchivePath(path: string) {
  if (path === ".blame/source-manifest.json" || path === ".blame/repository.bundle") return;
  if (!path.startsWith("workspace/")) throw new Error("Unexpected source archive namespace.");
  assertAllowedWorkspacePath(path.slice("workspace/".length));
}

function assertAllowedWorkspacePath(path: string) {
  const segments = path.toLowerCase().split("/");
  const basename = segments.at(-1) ?? "";
  if (
    segments.includes(".git") ||
    segments.includes(".ssh") ||
    segments.includes("node_modules") ||
    (basename.startsWith(".env") && basename !== ".env.example") ||
    [".npmrc", "id_rsa", "id_ed25519", "known_hosts"].includes(basename) ||
    path.toLowerCase() === ".docker/config.json"
  ) {
    throw new Error("Source archive contains a forbidden path.");
  }
}

function assertSymlink(root: string, path: string, target: string) {
  if (!target || target.startsWith("/")) throw new Error("Unsafe source symlink.");
  const resolved = normalize(join(dirname(path), target));
  if (!resolved.startsWith(`${root}/`)) throw new Error("Source symlink escapes staging.");
}

function validateManifest(value: SourceManifest) {
  if (
    value.version !== 1 ||
    !/^[a-f0-9]{40,64}$/i.test(value.baseCommit) ||
    !/^[a-f0-9]{64}$/i.test(value.workspaceHash) ||
    !value.files || typeof value.files !== "object"
  ) {
    throw runnerError("SOURCE_MANIFEST_INVALID", "Source manifest is invalid.");
  }
  if (Object.keys(value.files).length > 25_000) {
    throw runnerError("SOURCE_MANIFEST_INVALID", "Source manifest contains too many files.");
  }
  const folded = new Map<string, string>();
  for (const [path, metadata] of Object.entries(value.files)) {
    safePortablePath(path);
    assertAllowedWorkspacePath(path);
    const caseKey = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (folded.has(caseKey) && folded.get(caseKey) !== path) {
      throw runnerError("SOURCE_MANIFEST_INVALID", "Source manifest paths collide by case.");
    }
    folded.set(caseKey, path);
    if (
      !metadata ||
      !["file", "symlink"].includes(metadata.type) ||
      !/^[a-f0-9]{64}$/i.test(metadata.sha256) ||
      !Number.isSafeInteger(metadata.mode) ||
      metadata.mode < 0 || metadata.mode > 0o777 ||
      !Number.isSafeInteger(metadata.size) ||
      metadata.size < 0 || metadata.size > 256 * 1024 * 1024
    ) {
      throw runnerError("SOURCE_MANIFEST_INVALID", "Source file metadata is invalid.");
    }
    if (metadata.type === "symlink") {
      if (metadata.target === undefined) {
        throw runnerError("SOURCE_MANIFEST_INVALID", "Source symlink metadata is incomplete.");
      }
      assertSymlink("/workspace", join("/workspace", path), metadata.target);
    } else if (metadata.target !== undefined) {
      throw runnerError("SOURCE_MANIFEST_INVALID", "Source file metadata is inconsistent.");
    }
  }
}

function validatedHttpsUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw runnerError("SOURCE_URL_INVALID", "Source URL is invalid.");
  }
  return url;
}

function git(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Git reconstruction failed: ${stderr.slice(0, 500)}`)),
    );
  });
}

async function projectIdentity() {
  return { uid: await idValue("-u"), gid: await idValue("-g") };
}

function idValue(flag: string) {
  return new Promise<number>((resolve, reject) => {
    const child = spawn("id", [flag, "blame-project"], { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.once("error", reject);
    child.once("exit", (code) => {
      const value = Number(stdout.trim());
      code === 0 && Number.isSafeInteger(value) ? resolve(value) : reject(new Error("Project user missing."));
    });
  });
}
