import assert from "node:assert/strict";
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  prepareMacosRuntimeManifest,
  prepareWindowsRuntimeManifest,
} from "../../../../scripts/runtime-manifest.mjs";

type RootfsSpec = {
  kind?: string;
  sha256?: string;
  url?: string;
};

type WindowsRuntimeManifest = {
  clineSdkVersion?: string;
  rootfs?: Record<string, RootfsSpec>;
  runtimeAgentVersion?: string;
};

type MacosRuntimeManifest = WindowsRuntimeManifest & {
  baseImages?: Record<string, RootfsSpec>;
  lima?: {
    archives?: Record<string, Record<string, RootfsSpec>>;
    bin?: string;
    version?: string;
  };
  images?: Record<string, RootfsSpec>;
};

const manifestPath = path.resolve("resources/runtime/windows/manifest.json");
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

test("keeps managed runtime agent revisions aligned", async () => {
  for (const path of managedManifestPaths) {
    const manifest = JSON.parse(
      await readFile(path, "utf8"),
    ) as WindowsRuntimeManifest;
    assert.equal(manifest.runtimeAgentVersion, "2");
  }
});

test("pins every macOS runtime build input with a SHA-256", async () => {
  const manifest = JSON.parse(
    await readFile(managedManifestPaths[0], "utf8"),
  ) as MacosRuntimeManifest;

  assert.equal(manifest.lima?.version, "2.1.2");
  assert.equal(manifest.lima?.bin, "lima/bundle/bin");
  assertVerifiedSpecs(manifest.baseImages, ["aarch64", "x86_64"]);
  assertVerifiedSpecs(manifest.lima?.archives?.darwin, ["arm64", "x86_64"]);
  assertVerifiedSpecs(manifest.lima?.archives?.linux, ["aarch64", "x86_64"]);
});

test("keeps the Lima template while embedding its verified bundle", async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), "blame-runtime-test-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const bundleRoot = path.join(testRoot, "bundle");
  const previousBundle = process.env.BLAME_LIMA_BUNDLE_DIR;

  try {
    await cp(path.resolve("resources/runtime"), runtimeRoot, {
      recursive: true,
    });
    await createFakeLimaBundle(bundleRoot);
    process.env.BLAME_LIMA_BUNDLE_DIR = bundleRoot;
    await prepareMacosRuntimeManifest(runtimeRoot, {
      macosBundleArchitecture: "x86_64",
    });
    const templatePath = path.join(
      runtimeRoot,
      "macos/lima/blame-runtime.yaml",
    );
    await access(templatePath);
    assert.match(await readFile(templatePath, "utf8"), /location: "~"/);
    await access(path.join(runtimeRoot, "macos/lima/bundle/bin/limactl"));
    await access(
      path.join(runtimeRoot, "macos/lima/bundle/share/lima/templates"),
    );
    await access(
      path.join(runtimeRoot, "macos/lima/bundle/share/doc/lima/LICENSE"),
    );
    await assert.rejects(
      access(
        path.join(runtimeRoot, "macos/lima/bundle/share/doc/lima/templates"),
      ),
    );
  } finally {
    if (previousBundle) process.env.BLAME_LIMA_BUNDLE_DIR = previousBundle;
    else delete process.env.BLAME_LIMA_BUNDLE_DIR;
    await rm(testRoot, { force: true, recursive: true });
  }
});

test("uses published immutable artifacts for release packaging", async () => {
  const testRoot = await mkdtemp(path.join(tmpdir(), "blame-runtime-test-"));
  const runtimeRoot = path.join(testRoot, "runtime");
  const sha256 = "a".repeat(64);
  const publishedRuntime = {
    artifacts: {
      macos: { x86_64: { sha256, url: "https://cdn.test/macos.qcow2" } },
      windows: { amd64: { sha256, url: "https://cdn.test/windows.tar.gz" } },
    },
  };

  try {
    await cp(path.resolve("resources/runtime"), runtimeRoot, {
      recursive: true,
    });
    await prepareWindowsRuntimeManifest(runtimeRoot, {
      publishedRuntime,
      requireWindowsPrebuiltArchitecture: "amd64",
    });
    await prepareMacosRuntimeManifest(runtimeRoot, {
      publishedRuntime,
      requireMacosPrebuiltArchitecture: "x86_64",
    });
    const windows = await readRuntimeManifest(runtimeRoot, "windows");
    const macos = await readRuntimeManifest(runtimeRoot, "macos");
    assert.equal(windows.rootfs?.amd64.url, "https://cdn.test/windows.tar.gz");
    assert.equal(macos.images?.x86_64.url, "https://cdn.test/macos.qcow2");
  } finally {
    await rm(testRoot, { force: true, recursive: true });
  }
});

function assertRootfsSpec(spec: RootfsSpec | undefined) {
  assert.ok(spec?.url);
  assert.ok(!spec.kind || ["ubuntu", "blame-prebaked"].includes(spec.kind));
  assert.ok(!spec.sha256 || /^[a-f0-9]{64}$/i.test(spec.sha256));
}

function assertVerifiedSpecs(
  specs: Record<string, RootfsSpec> | undefined,
  architectures: string[],
) {
  for (const architecture of architectures) {
    const spec = specs?.[architecture];
    assert.ok(spec?.url);
    assert.match(spec.sha256 ?? "", /^[a-f0-9]{64}$/i);
  }
}

async function createFakeLimaBundle(bundleRoot: string) {
  const binRoot = path.join(bundleRoot, "bin");
  const documentationRoot = path.join(bundleRoot, "share/doc/lima");
  await mkdir(binRoot, { recursive: true });
  await mkdir(documentationRoot, { recursive: true });
  await mkdir(path.join(bundleRoot, "share/lima/templates"), {
    recursive: true,
  });
  await writeFile(path.join(binRoot, "limactl"), "", { mode: 0o755 });
  await writeFile(path.join(binRoot, "lima"), "", { mode: 0o755 });
  await writeFile(path.join(documentationRoot, "LICENSE"), "Apache-2.0\n");
  await symlink(
    "../../lima/templates",
    path.join(documentationRoot, "templates"),
  );
}

async function readRuntimeManifest(runtimeRoot: string, platform: string) {
  return JSON.parse(
    await readFile(path.join(runtimeRoot, platform, "manifest.json"), "utf8"),
  ) as MacosRuntimeManifest;
}

function normalizePackageVersion(value: unknown) {
  return typeof value === "string"
    ? value.trim().match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/)?.[0]
    : undefined;
}
