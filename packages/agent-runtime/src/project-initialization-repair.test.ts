import assert from "node:assert/strict";
import test from "node:test";

import {
  parseProjectInitializationRepairResult,
  projectInitializationRepairPrompt,
} from "./project-initialization-repair.js";

function canonicalRepair() {
  return {
    classification: "repairable_initialization",
    reason: "The preview command changed.",
    previewManifest: {
      confidence: "high",
      project: { root: ".", detectedStack: ["node"], confidence: "high" },
      setup: [
        {
          id: "deps",
          container: { image: "node:22-bookworm" },
          workingDir: "/workspace",
          command:
            "corepack prepare pnpm@10.33.2 --activate && corepack pnpm install",
        },
      ],
      services: [
        {
          id: "web",
          kind: "preview",
          container: { image: "node:22-bookworm" },
          workingDir: "/workspace",
          command:
            "corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev",
          endpoints: [
            {
              id: "http",
              protocol: "http",
              port: 3000,
              healthcheck: { type: "http", path: "/", timeoutMs: 30_000 },
            },
          ],
        },
      ],
      caches: [],
      risks: [],
      probes: [],
    },
    runConfigurations: [
      {
        id: "web",
        name: "Web application",
        command: "npm run dev",
        cwd: ".",
        default: true,
        category: "web",
        services: ["web"],
        previewService: "web",
        scopes: ["web"],
      },
    ],
  };
}

test("generates repaired artifacts from a canonical manifest", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify(canonicalRepair()),
  );

  assert.equal(result.classification, "repairable_initialization");
  assert.equal(result.previewManifest?.services[0]?.kind, "preview");
  assert.match(result.dockerCompose ?? "", /blame\.setup: "true"/);
  assert.match(result.dockerCompose ?? "", /"127\.0\.0\.1::3000"/);
});

test("does not accept derived artifacts as a compatibility fallback", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "Old artifacts changed.",
          setupScript: "npm install",
          dockerCompose: "services: {}",
          runConfigurations: [],
        }),
      ),
    /canonical previewManifest/,
  );
});

test("rejects historical manifest and unknown service references", () => {
  const historical = canonicalRepair();
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          ...historical,
          previewManifest: { ...historical.previewManifest, version: 2 },
        }),
      ),
    /version is no longer supported/,
  );

  const invalid = canonicalRepair();
  invalid.runConfigurations[0]!.services = ["missing"];
  invalid.runConfigurations[0]!.previewService = "missing";
  assert.throws(
    () => parseProjectInitializationRepairResult(JSON.stringify(invalid)),
    /previewService must be a configured service|references unknown service missing/,
  );
});

test("omits artifacts for non-initialization failures", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify({
      classification: "project_code_failure",
      reason: "The application fails during startup.",
      previewManifest: canonicalRepair().previewManifest,
    }),
  );
  assert.deepEqual(result, {
    classification: "project_code_failure",
    reason: "The application fails during startup.",
  });
});

test("requires complete run configurations for a repair", () => {
  const value = canonicalRepair() as Record<string, unknown>;
  delete value.runConfigurations;
  assert.throws(
    () => parseProjectInitializationRepairResult(JSON.stringify(value)),
    /missing runConfigurations/,
  );
});

test("includes validation feedback in repair correction prompts", () => {
  const input = {
    apiConnection: { url: "https://example.com", token: "token" },
    providerId: "provider",
    modelId: "model",
    cwd: "/project",
    workspaceRoot: "/project",
    setupScript: "",
    dockerCompose: "",
    runConfigurations: [],
    diagnostics: {
      setupLog: "",
      launchError: "Preview failed",
      composeConfig: "",
      composePs: "",
      serviceLogs: {},
    },
  };
  const prompt = projectInitializationRepairPrompt(
    input,
    { rootName: "project", topLevelEntries: [], files: {}, gitLog: [] },
    {
      validationError: "Manifest is invalid.",
      previousResult: '{"classification":"repairable_initialization"}',
    },
  );

  assert.match(prompt, /Your previous response was rejected by validation/);
  assert.match(prompt, /Validation error: Manifest is invalid\./);
});
