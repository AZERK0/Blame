import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdtemp, readFile, readlink, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Transform } from "node:stream"
import { promisify } from "node:util"
import { createGzip } from "node:zlib"
import { pack } from "tar-stream"
import { pipeline } from "node:stream/promises"
import { snapshotWorkspace } from "./workspace-snapshot.ts"

const execFileAsync = promisify(execFile)
const archiveTimestamp = new Date(0)
const maximumArtifactBytes = 256 * 1024 * 1024

export type BuiltWorkspaceArtifact = {
  content: Buffer
  sha256: string
  size: number
  sourceRevision: string
  workspaceHash: string
}

export async function buildWorkspaceArtifact(
  root: string,
  attempt = 0,
): Promise<BuiltWorkspaceArtifact> {
  const temporary = await mkdtemp(join(tmpdir(), "blame-workspace-artifact-"))
  try {
    const sourceRevision = await git(root, ["rev-parse", "HEAD"])
    await assertPortableRepository(root)
    const snapshot = await snapshotWorkspace(root)
    const bundlePath = join(temporary, "repository.bundle")
    await git(root, ["bundle", "create", bundlePath, "HEAD"])
    const archive = pack()
    const chunks: Buffer[] = []
    const gzip = createGzip({ level: 6 })
    gzip.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    const writing = pipeline(archive, gzip)
    try {
      archive.entry(
        { name: ".blame/source-manifest.json", mode: 0o600, mtime: archiveTimestamp },
        JSON.stringify({
          version: 1,
          baseCommit: sourceRevision,
          workspaceHash: snapshot.hash,
          files: snapshot.files,
        }),
      )
      await appendDiskFile(archive, bundlePath, ".blame/repository.bundle", 0o600)
      for (const [path, metadata] of Object.entries(snapshot.files)) {
        const absolute = join(root, path)
        if (metadata.type === "symlink") {
          const target = await readlink(absolute)
          if (target !== metadata.target) throw new Error("Workspace symlink changed during upload")
          archive.entry({
            name: `workspace/${path}`,
            type: "symlink",
            linkname: target,
            mode: metadata.mode,
            mtime: archiveTimestamp,
          })
        } else {
          await appendDiskFile(
            archive,
            absolute,
            `workspace/${path}`,
            metadata.mode,
            metadata,
          )
        }
      }
      archive.finalize()
      await writing
    } catch (error) {
      archive.destroy(error as Error)
      await writing.catch(() => undefined)
      if (attempt < 2) return buildWorkspaceArtifact(root, attempt + 1)
      throw new Error("Workspace kept changing while its cloud artifact was built", { cause: error })
    }
    const verified = await snapshotWorkspace(root)
    const verifiedRevision = await git(root, ["rev-parse", "HEAD"])
    if (verified.hash !== snapshot.hash || verifiedRevision !== sourceRevision) {
      if (attempt < 2) return buildWorkspaceArtifact(root, attempt + 1)
      throw new Error("Workspace kept changing while its cloud artifact was built")
    }
    const content = Buffer.concat(chunks)
    if (content.byteLength < 1 || content.byteLength > maximumArtifactBytes) {
      throw new Error("Workspace artifact exceeds the managed transfer limit")
    }
    return {
      content,
      sha256: createHash("sha256").update(content).digest("hex"),
      size: content.byteLength,
      sourceRevision,
      workspaceHash: snapshot.hash,
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

async function appendDiskFile(
  archive: ReturnType<typeof pack>,
  path: string,
  name: string,
  mode: number,
  expected?: { sha256: string; size: number },
) {
  const stat = await lstat(path)
  const size = expected?.size ?? stat.size
  const entry = archive.entry({ name, mode, size, mtime: archiveTimestamp })
  if (!expected) {
    await pipeline(createReadStream(path), entry)
    return
  }
  const hash = createHash("sha256")
  let bytes = 0
  const verifier = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.byteLength
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(createReadStream(path), verifier, entry)
  if (bytes !== size || hash.digest("hex") !== expected.sha256) {
    throw new Error("Workspace file changed during upload")
  }
}

async function assertPortableRepository(root: string) {
  const submodules = await git(root, ["ls-files", "--stage", "--", ".gitmodules"])
  if (submodules) throw new Error("Cloud preview does not support Git submodules yet")
  const forbiddenHistory = await git(root, [
    "log", "--all", "--format=", "--name-only", "--", ".env", ".env.*", ".npmrc", ".ssh", ".docker/config.json",
  ])
  if (forbiddenHistory) throw new Error("Repository history contains credential-bearing paths that cannot be uploaded")
  const attributes = await readFile(join(root, ".gitattributes"), "utf8").catch(() => "")
  if (/filter\s*=\s*lfs/i.test(attributes)) throw new Error("Cloud preview does not support Git LFS yet")
}

async function git(root: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout.trim()
}
