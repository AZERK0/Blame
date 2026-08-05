import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import { promisify } from "node:util"
import { gunzipSync } from "node:zlib"
import test from "node:test"
import { extract } from "tar-stream"
import { buildWorkspaceArtifact, buildWorkspaceDeltaArtifact } from "./workspace-artifact.ts"

const exec = promisify(execFile)

test("builds a reproducible source artifact without runtime secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-source-test-"))
  try {
    await exec("git", ["init", root])
    await writeFile(join(root, "index.js"), "console.log('ok')\n")
    await exec("git", ["-C", root, "add", "index.js"])
    await exec("git", [
      "-C",
      root,
      "-c",
      "user.name=Blame Test",
      "-c",
      "user.email=test@blame.so",
      "commit",
      "-m",
      "base",
    ])
    await writeFile(join(root, ".env"), "HISTORICAL_SECRET=never-upload-history\n")
    await exec("git", ["-C", root, "add", ".env"])
    await exec("git", [
      "-C",
      root,
      "-c",
      "user.name=Blame Test",
      "-c",
      "user.email=test@blame.so",
      "commit",
      "-m",
      "add old environment",
    ])
    await unlink(join(root, ".env"))
    await exec("git", ["-C", root, "add", ".env"])
    await exec("git", [
      "-C",
      root,
      "-c",
      "user.name=Blame Test",
      "-c",
      "user.email=test@blame.so",
      "commit",
      "-m",
      "remove old environment",
    ])
    await writeFile(join(root, ".env"), "SECRET=never-upload\n")
    const first = await buildWorkspaceArtifact(root)
    const second = await buildWorkspaceArtifact(root)
    assert.equal(first.workspaceHash, second.workspaceHash)
    assert.equal(first.sourceRevision, second.sourceRevision)
    assert.equal(first.sha256, second.sha256)
    assert.ok(first.size > 0)
    const entries = await archiveEntries(first.content)
    assert.equal(entries.has("workspace/.env"), false)
    const bundle = join(root, "repository.bundle")
    await writeFile(bundle, entries.get(".blame/repository.bundle")!)
    const clone = join(root, "transport-clone")
    await exec("git", ["clone", "--quiet", bundle, clone])
    const { stdout: history } = await exec("git", ["-C", clone, "log", "--all", "-p"])
    assert.equal(history.includes("HISTORICAL_SECRET=never-upload-history"), false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("builds a delta against the committed tree and includes new files", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-source-delta-test-"))
  try {
    await exec("git", ["init", root])
    await writeFile(join(root, "index.js"), "console.log('base')\n")
    await exec("git", ["-C", root, "add", "index.js"])
    await exec("git", [
      "-C",
      root,
      "-c",
      "user.name=Blame Test",
      "-c",
      "user.email=test@blame.so",
      "commit",
      "-m",
      "base",
    ])
    await writeFile(join(root, "index.js"), "console.log('changed')\n")
    await writeFile(join(root, "new.txt"), "new\n")
    const delta = await buildWorkspaceDeltaArtifact(root)
    assert.ok(delta.baseHash.match(/^[a-f0-9]{64}$/))
    const entries = await archiveEntries(delta.content)
    const manifest = JSON.parse(entries.get(".blame/delta-manifest.json")!.toString("utf8"))
    assert.ok(manifest.finalHash.match(/^[a-f0-9]{64}$/))
    assert.deepEqual(manifest.changed.sort(), ["index.js", "new.txt"])
    assert.deepEqual(manifest.deleted, [])
    assert.equal(entries.has("files/index.js"), true)
    assert.equal(entries.has("files/new.txt"), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

function archiveEntries(content: Buffer) {
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    const entries = new Map<string, Buffer>()
    const archive = extract()
    archive.on("entry", (header, stream, next) => {
      const chunks: Buffer[] = []
      stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      stream.once("end", () => {
        entries.set(header.name, Buffer.concat(chunks))
        next()
      })
      stream.once("error", reject)
    })
    archive.once("finish", () => resolve(entries))
    archive.once("error", reject)
    Readable.from(gunzipSync(content)).pipe(archive)
  })
}
