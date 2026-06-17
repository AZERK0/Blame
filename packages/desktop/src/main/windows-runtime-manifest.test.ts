import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

type RootfsSpec = {
  kind?: string;
  sha256?: string;
  url?: string;
};

type WindowsRuntimeManifest = {
  rootfs?: Record<string, RootfsSpec>;
};

const manifestPath = path.resolve(
  "resources/runtime/windows/manifest.json",
);

test("accepts Windows runtime rootfs specs with optional prebaked metadata", async () => {
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as WindowsRuntimeManifest;

  assertRootfsSpec(manifest.rootfs?.amd64);
  assertRootfsSpec(manifest.rootfs?.arm64);
});

function assertRootfsSpec(spec: RootfsSpec | undefined) {
  assert.ok(spec?.url);
  assert.ok(!spec.kind || ["ubuntu", "blame-prebaked"].includes(spec.kind));
  assert.ok(!spec.sha256 || /^[a-f0-9]{64}$/i.test(spec.sha256));
}
