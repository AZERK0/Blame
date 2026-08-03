import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { Transform } from "node:stream"
import { promisify } from "node:util"
import { createGzip } from "node:zlib"
import { pack } from "tar-stream"
import { pipeline } from "node:stream/promises"
import { forbiddenWorkspacePath, snapshotWorkspace } from "./workspace-snapshot.ts"

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
    await createSanitizedBundle(root, temporary, bundlePath)
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
  const attributes = await readFile(join(root, ".gitattributes"), "utf8").catch(() => "")
  if (/filter\s*=\s*lfs/i.test(attributes)) throw new Error("Cloud preview does not support Git LFS yet")
}

async function createSanitizedBundle(root: string, temporary: string, bundlePath: string) {
  const repository = join(temporary, "repository")
  await mkdir(repository, { recursive: true })
  await git(repository, ["init", "--quiet", "--initial-branch=main"])
  const entries = (await gitOutput(root, ["ls-tree", "-rz", "HEAD"])).split("\0").filter(Boolean)
  for (const entry of entries) {
    const separator = entry.indexOf("\t")
    const [mode, type, hash] = entry.slice(0, separator).split(" ")
    const path = entry.slice(separator + 1)
    if (separator < 1 || !mode || !type || !hash || !path) {
      throw new Error("Repository tree contains an invalid entry")
    }
    if (type === "commit") throw new Error("Cloud preview does not support Git submodules yet")
    if (type !== "blob" || !["100644", "100755", "120000"].includes(mode)) {
      throw new Error("Repository tree contains an unsupported entry")
    }
    if (forbiddenWorkspacePath(path)) continue
    const content = await gitBuffer(root, ["cat-file", "blob", hash])
    const destination = safeTemporaryPath(repository, path)
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(destination, content, {
      mode: mode === "100755" ? 0o755 : 0o600,
    })
    const importedHash = await git(repository, ["hash-object", "-w", "--", path])
    if (importedHash !== hash) throw new Error("Repository object changed during sanitization")
    await git(repository, ["update-index", "--add", "--cacheinfo", mode, hash, path])
  }
  const tree = await git(repository, ["write-tree"])
  const identity = {
    GIT_AUTHOR_NAME: "Blame",
    GIT_AUTHOR_EMAIL: "preview@blame.local",
    GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
    GIT_COMMITTER_NAME: "Blame",
    GIT_COMMITTER_EMAIL: "preview@blame.local",
    GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
  }
  const commit = await git(
    repository,
    ["commit-tree", tree, "-m", "Blame managed preview snapshot"],
    identity,
  )
  await git(repository, ["update-ref", "refs/heads/main", commit])
  await git(repository, ["bundle", "create", bundlePath, "refs/heads/main"])
}

function safeTemporaryPath(root: string, path: string) {
  const normalized = path.replaceAll("\\", "/")
  const destination = join(root, normalized)
  if (normalized !== path || !path || path.startsWith("/") || !destination.startsWith(`${root}/`)) {
    throw new Error("Repository tree contains a non-portable path")
  }
  return destination
}

async function git(root: string, args: string[], environment?: Record<string, string>) {
  return (await gitOutput(root, args, environment)).trim()
}

async function gitOutput(root: string, args: string[], environment?: Record<string, string>) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...environment },
    maxBuffer: 64 * 1024 * 1024,
  })
  return stdout
}

async function gitBuffer(root: string, args: string[]) {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "buffer",
    maxBuffer: maximumArtifactBytes,
  })
  return Buffer.from(stdout)
}
