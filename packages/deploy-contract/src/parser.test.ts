import assert from "node:assert/strict";
import test from "node:test";
import type { PreviewManifest } from "@blame/preview-contract";
import { deriveDeploymentManifest } from "./derive.js";
import { parseDeploymentManifest } from "./parser.js";

test("parses a strict supported manifest", () => {
  const parsed = parseDeploymentManifest({
    provider: "vercel",
    rootDirectory: "apps/web",
    framework: "nextjs",
    buildCommand: "pnpm build",
    requiredEnvironmentKeys: ["API_URL"],
    compatibility: { status: "conditional", blockers: [], warnings: [] },
  });
  assert.equal(parsed.rootDirectory, "apps/web");
  assert.equal(parsed.framework, "nextjs");
});

test("normalizes the workspace root", () => {
  const parsed = parseDeploymentManifest({
    provider: "vercel",
    rootDirectory: "./",
    framework: null,
    requiredEnvironmentKeys: [],
    compatibility: { status: "supported", blockers: [], warnings: [] },
  });
  assert.equal(parsed.rootDirectory, ".");
});

test("rejects unsafe paths, commands and unsupported fields", () => {
  const base = {
    provider: "vercel",
    rootDirectory: ".",
    framework: null,
    requiredEnvironmentKeys: [],
    compatibility: { status: "supported", blockers: [], warnings: [] },
  };
  assert.throws(() =>
    parseDeploymentManifest({ ...base, rootDirectory: "../outside" }),
  );
  assert.throws(() =>
    parseDeploymentManifest({ ...base, buildCommand: "npm build\ncat .env" }),
  );
  assert.throws(() => parseDeploymentManifest({ ...base, token: "secret" }));
});

test("derives a Vite target and environment warning", () => {
  const derived = deriveDeploymentManifest({
    previewManifest: manifest(),
    runConfigurations: [
      {
        id: "web",
        command: "pnpm dev",
        cwd: "apps/web",
        default: true,
        category: "web",
        services: ["web"],
        previewService: "web",
        scopes: ["apps/web"],
      },
    ],
  });
  assert.equal(derived.framework, "vite");
  assert.equal(derived.compatibility.status, "conditional");
  assert.deepEqual(derived.requiredEnvironmentKeys, ["API_URL"]);
});

test("blocks a local database dependency", () => {
  const preview = manifest();
  preview.services.push({
    id: "database",
    kind: "dependency",
    container: { image: "postgres:17" },
    endpoints: [{ id: "db", protocol: "tcp", port: 5432 }],
  });
  const derived = deriveDeploymentManifest({
    previewManifest: preview,
    runConfigurations: [
      {
        id: "web",
        command: "pnpm dev",
        cwd: "apps/web",
        default: true,
        category: "web",
        services: ["web", "database"],
        previewService: "web",
        scopes: ["apps/web"],
      },
    ],
  });
  assert.equal(derived.compatibility.status, "unsupported");
  assert.equal(
    derived.compatibility.blockers[0]?.code,
    "DEPLOY_LOCAL_DATABASE_REQUIRED",
  );
});

function manifest(): PreviewManifest {
  return {
    confidence: "high",
    project: { root: ".", detectedStack: ["Vite", "React"] },
    setup: [],
    services: [
      {
        id: "web",
        kind: "preview",
        container: { image: "node:24" },
        command: "pnpm dev",
        environment: { API_URL: "http://api:3000" },
        endpoints: [{ id: "http", protocol: "http", port: 5173 }],
      },
    ],
    caches: [],
    risks: [],
    probes: [],
  };
}
