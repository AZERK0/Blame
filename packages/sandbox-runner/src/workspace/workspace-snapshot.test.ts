import assert from "node:assert/strict";
import test from "node:test";
import {
  assertSafeSymlink,
  forbiddenWorkspacePath,
} from "./workspace-snapshot.js";

test("remote snapshots exclude credential-bearing and generated paths", () => {
  for (const path of [
    ".env",
    ".env.local",
    ".npmrc",
    ".ssh/id_ed25519",
    ".docker/config.json",
    "node_modules/pkg/index.js",
    ".next/server.js",
    ".turbo/cache/state.bin",
    ".cache/tool/result",
    ".vite/deps/index.js",
    ".parcel-cache/data.bin",
    "dist/bundle.js",
    "packages/desktop/out/main/index.js",
    ".blame/runtime-tools/lima/bin/limactl",
    "server.log",
  ]) {
    assert.equal(forbiddenWorkspacePath(path), true, path);
  }
  assert.equal(forbiddenWorkspacePath(".env.example"), false);
  assert.equal(forbiddenWorkspacePath("src/index.ts"), false);
});

test("remote snapshots reject symlinks escaping the workspace", () => {
  assert.doesNotThrow(() =>
    assertSafeSymlink("packages/app/link", "../shared"),
  );
  assert.throws(
    () => assertSafeSymlink("link", "../outside"),
    /escapes workspace/,
  );
  assert.throws(() => assertSafeSymlink("link", "/etc/passwd"), /Unsafe/);
});
