import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = new URL("./desktop-release.mjs", import.meta.url).pathname;

async function artifacts(root, files) {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

function collect(source, output) {
  return spawnSync(process.execPath, [script, "collect", source, output], { encoding: "utf8" });
}

function macMetadata(arch) {
  return `version: 1.2.0\nfiles:\n  - url: blame-mac-${arch}.zip\n    sha512: ${arch}\n    size: 1\npath: blame-mac-${arch}.zip\nreleaseDate: 2026-10-16T00:00:00.000Z\n`;
}

test("collect merges per-platform artifacts into one release with checksums", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-release-test-"));
  try {
    await artifacts(join(root, "artifacts"), {
      "desktop-macos-x64/latest-mac.yml": macMetadata("x64"),
      "desktop-macos-x64/blame-mac-x64.zip": "x64",
      "desktop-macos-arm64/latest-mac.yml": macMetadata("arm64"),
      "desktop-macos-arm64/blame-mac-arm64.zip": "arm64",
      "desktop-windows-x64/latest.yml": "version: 1.2.0\n",
      "desktop-windows-x64/blame-win-x64.exe": "exe",
      "desktop-linux-x64/latest-linux.yml": "version: 1.2.0\n",
      "desktop-linux-x64/blame-linux-x86_64.AppImage": "appimage",
      "desktop-linux-x64/builder-debug.yml": "ignored",
    });
    const result = collect(join(root, "artifacts"), join(root, "release"));
    assert.equal(result.status, 0, result.stderr);

    const files = await readdir(join(root, "release"));
    assert.deepEqual(files.sort(), [
      "SHA256SUMS",
      "blame-linux-x86_64.AppImage",
      "blame-mac-arm64.zip",
      "blame-mac-x64.zip",
      "blame-win-x64.exe",
      "latest-linux.yml",
      "latest-mac.yml",
      "latest.yml",
    ]);
    const mac = await readFile(join(root, "release/latest-mac.yml"), "utf8");
    assert.match(mac, /blame-mac-x64\.zip/);
    assert.match(mac, /blame-mac-arm64\.zip/);
    const checksums = (await readFile(join(root, "release/SHA256SUMS"), "utf8")).trim().split("\n");
    assert.equal(checksums.length, 7);
    assert.ok(checksums.every((line) => /^[a-f0-9]{64} {2}\S+$/.test(line)));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("collect rejects duplicate installers and incomplete releases", async () => {
  const root = await mkdtemp(join(tmpdir(), "desktop-release-test-"));
  try {
    await artifacts(join(root, "duplicate"), {
      "a/blame-win-x64.exe": "a",
      "b/blame-win-x64.exe": "b",
    });
    assert.match(collect(join(root, "duplicate"), join(root, "out")).stderr, /Duplicate release file: blame-win-x64\.exe/);

    await artifacts(join(root, "incomplete"), { "a/latest.yml": "version: 1.2.0\n" });
    assert.match(collect(join(root, "incomplete"), join(root, "out")).stderr, /missing latest-mac\.yml, latest-linux\.yml/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
