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
  clineSdkVersion?: string;
  rootfs?: Record<string, RootfsSpec>;
};

const manifestPath = path.resolve(
  "resources/runtime/windows/manifest.json",
);
const managedManifestPaths = [
  path.resolve("resources/runtime/macos/manifest.json"),
  manifestPath,
];
const agentRuntimePackagePath = path.resolve("../agent-runtime/package.json");

test("accepts Windows runtime rootfs specs with optional prebaked metadata", async () => {
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as WindowsRuntimeManifest;

  assertRootfsSpec(manifest.rootfs?.amd64);
  assertRootfsSpec(manifest.rootfs?.arm64);
});

test("keeps managed runtime Cline SDK versions aligned with agent runtime", async () => {
  const packageJson = JSON.parse(
    await readFile(agentRuntimePackagePath, "utf8"),
  );
  const expectedVersion = normalizePackageVersion(
    packageJson.dependencies?.["@cline/sdk"],
  );

  assert.ok(expectedVersion);
  for (const path of managedManifestPaths) {
    const manifest = JSON.parse(
      await readFile(path, "utf8"),
    ) as WindowsRuntimeManifest;
    assert.equal(manifest.clineSdkVersion, expectedVersion);
  }
});

function assertRootfsSpec(spec: RootfsSpec | undefined) {
  assert.ok(spec?.url);
  assert.ok(!spec.kind || ["ubuntu", "blame-prebaked"].includes(spec.kind));
  assert.ok(!spec.sha256 || /^[a-f0-9]{64}$/i.test(spec.sha256));
}

function normalizePackageVersion(value: unknown) {
  return typeof value === "string"
    ? value.trim().match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0]
    : undefined;
}
