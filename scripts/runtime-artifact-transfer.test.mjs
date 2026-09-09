import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import { restoreRuntimeArtifacts, runtimeStagingPrefix, stageRuntimeArtifact } from "./runtime-artifact-transfer.mjs";

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    async uploadStaged(files, prefix) {
      for (const file of files) objects.set(`${prefix}/${basename(file)}`, await readFile(file));
    },
    async objectText(key) {
      if (!objects.has(key)) throw new Error(`Missing object ${key}`);
      return objects.get(key).toString();
    },
    async download(key, destination) { await writeFile(destination, objects.get(key)); },
  };
}

async function stageFixtures(storage, directory) {
  const targets = [["windows", "amd64", "wsl", "tar.gz"], ["windows", "arm64", "wsl", "tar.gz"],
    ["macos", "x86_64", "lima", "qcow2"], ["macos", "aarch64", "lima", "qcow2"]];
  for (const [platform, architecture, kind, extension] of targets) {
    await mkdir(join(directory, platform), { recursive: true });
    await writeFile(join(directory, platform, `blame-runtime-${kind}-${architecture}-v9.${extension}`), `${platform}/${architecture}`);
    await stageRuntimeArtifact(storage, { source: "123/1", platform, architecture, version: "9", directory });
  }
}

test("runtime staging round trip verifies all architectures and detects corruption", async () => {
  const directory = await mkdtemp(join(tmpdir(), "runtime-transfer-test-"));
  try {
    const storage = memoryStorage();
    await stageFixtures(storage, join(directory, "source"));
    const options = { source: "123/1", version: "9", directory: join(directory, "restored") };
    await restoreRuntimeArtifacts(storage, options);
    assert.equal(await readFile(join(options.directory, "macos/blame-runtime-lima-aarch64-v9.qcow2"), "utf8"), "macos/aarch64");
    storage.objects.set("_staging/runtime/123/1/windows/blame-runtime-wsl-amd64-v9.tar.gz", Buffer.from("corrupted"));
    await assert.rejects(restoreRuntimeArtifacts(storage, options), /checksum mismatch/);
    await assert.rejects(restoreRuntimeArtifacts(storage, { ...options, source: "123/2" }), /Missing object/);
    await assert.rejects(restoreRuntimeArtifacts(storage, { ...options, version: "10" }), /Missing object/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("runtime staging rejects unsafe or ambiguous sources", () => {
  for (const source of ["", "123", "../latest", "123/1/../2"]) assert.throws(() => runtimeStagingPrefix(source));
});
