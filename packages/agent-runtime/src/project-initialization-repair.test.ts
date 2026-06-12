import assert from "node:assert/strict"
import test from "node:test"

import {
  parseProjectInitializationRepairResult,
  projectInitializationRepairPrompt,
} from "./project-initialization-repair.js"

const validCompose = `services:
  web:
    image: node:22
    user: "\${BLAME_HOST_UID}:\${BLAME_HOST_GID}"
    ports:
      - "127.0.0.1::3000"`

test("parses and validates repairable initialization artifacts", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify({
      classification: "repairable_initialization",
      reason: "The preview command is invalid.",
      setupScript: "#!/usr/bin/env bash\nnpm install",
      dockerCompose: validCompose,
      runConfigurations: [
        {
          id: "web",
          name: "Web application",
          command: "npm run dev",
          cwd: ".",
          default: true,
        },
      ],
    }),
  )

  assert.equal(result.classification, "repairable_initialization")
  assert.equal(result.dockerCompose, validCompose)
  assert.equal(result.runConfigurations?.[0]?.command, "npm run dev")
})

test("parses repairable preview manifests and generates artifacts", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify({
      classification: "repairable_initialization",
      reason: "The preview command is invalid.",
      previewManifest: {
        version: 1,
        confidence: "high",
        project: { root: ".", detectedStack: ["node"], confidence: "high" },
        setup: [
          {
            id: "deps",
            image: "node:22-bookworm",
            workingDir: "/workspace",
            command:
              "corepack prepare pnpm@10.33.2 --activate && corepack pnpm install",
          },
        ],
        services: [
          {
            id: "web",
            kind: "preview",
            image: "node:22-bookworm",
            workingDir: "/workspace",
            command:
              "corepack prepare pnpm@10.33.2 --activate && corepack pnpm dev",
            preview: { internalPort: 3000, protocol: "http", path: "/" },
            healthcheck: { type: "http", path: "/", timeoutMs: 30_000 },
          },
        ],
        caches: [],
        risks: [],
      },
      runConfigurations: [],
    }),
  )

  assert.equal(result.classification, "repairable_initialization")
  assert.equal(result.previewManifest?.services[0]?.kind, "preview")
  assert.match(result.dockerCompose ?? "", /blame\.setup: "true"/)
})

test("omits artifacts for project code failures", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify({
      classification: "project_code_failure",
      reason: "The application fails during startup.",
      setupScript: "ignored",
      dockerCompose: "ignored",
    }),
  )

  assert.deepEqual(result, {
    classification: "project_code_failure",
    reason: "The application fails during startup.",
  })
})

test("omits artifacts for external failures", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify({
      classification: "external_failure",
      reason: "The container registry is unavailable.",
    }),
  )

  assert.deepEqual(result, {
    classification: "external_failure",
    reason: "The container registry is unavailable.",
  })
})

test("rejects invalid repaired artifacts", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "Compose is invalid.",
          setupScript: "npm install",
          dockerCompose: "services:\n  web:\n    image: node",
          runConfigurations: [],
        }),
      ),
    /runtime-allocated host ports/,
  )
})

test("accepts local public origin placeholders in repaired artifacts", () => {
  const result = parseProjectInitializationRepairResult(
    JSON.stringify({
      classification: "repairable_initialization",
      reason: "The auth origin is materialized by Blame before runtime launch.",
      setupScript: "npm install",
      dockerCompose: `${validCompose}
    environment:
      APP_URL: "http://127.0.0.1:3000"`,
      runConfigurations: [],
    }),
  )

  assert.equal(result.classification, "repairable_initialization")
})

test("requires complete run configurations for repairable initialization", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "The preview command is invalid.",
          setupScript: "npm install",
          dockerCompose: validCompose,
        }),
      ),
    /missing runConfigurations/,
  )
})

test("rejects preview services without a project source mount", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "The preview service is obsolete.",
          setupScript: "npm install",
          dockerCompose: `${validCompose}
    working_dir: /workspace
    labels:
      blame.preview: "true"`,
          runConfigurations: [],
        }),
      ),
    /must mount the project source at \/workspace/,
  )
})

test("rejects unescaped container home references", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "The preview command is obsolete.",
          setupScript: "npm install",
          dockerCompose: `${validCompose}
    command: sh -lc 'mkdir -p "$HOME"'`,
          runConfigurations: [],
        }),
      ),
    /escape container HOME references/,
  )
})

test("rejects Node preview services without a dependency install", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "The preview command is obsolete.",
          setupScript: "echo ready",
          dockerCompose: validCompose,
          runConfigurations: [],
        }),
        {
          rootName: "project",
          topLevelEntries: [],
          files: { "package.json": '{"dependencies":{"nuxt":"^3.16.2"}}' },
          gitLog: [],
        },
      ),
    /must install detected Node dependencies/,
  )
})

test("rejects Nuxt preview commands without a build step", () => {
  assert.throws(
    () =>
      parseProjectInitializationRepairResult(
        JSON.stringify({
          classification: "repairable_initialization",
          reason: "The preview command is obsolete.",
          setupScript: "echo ready",
          dockerCompose: `${validCompose}
    command: sh -lc 'npm install && npm run preview'`,
          runConfigurations: [],
        }),
        {
          rootName: "project",
          topLevelEntries: [],
          files: { "package.json": '{"dependencies":{"nuxt":"^3.16.2"}}' },
          gitLog: [],
        },
      ),
    /must build Nuxt before running its preview script/,
  )
})

test("includes validation feedback in repair correction prompts", () => {
  const input = {
    apiConnection: { url: "https://example.com", token: "token" },
    providerId: "provider",
    modelId: "model",
    cwd: "/project",
    workspaceRoot: "/project",
    setupScript: "npm install",
    dockerCompose: validCompose,
    runConfigurations: [],
    diagnostics: {
      setupLog: "",
      launchError: "Preview failed",
      composeConfig: "",
      composePs: "",
      serviceLogs: {},
    },
  }
  const prompt = projectInitializationRepairPrompt(
    input,
    { rootName: "project", topLevelEntries: [], files: {}, gitLog: [] },
    {
      validationError: "Compose is invalid.",
      previousResult: '{"classification":"repairable_initialization"}',
    },
  )

  assert.match(prompt, /Your previous response was rejected by validation/)
  assert.match(prompt, /Validation error: Compose is invalid\./)
  assert.match(prompt, /Previous rejected response: \{"classification":"repairable_initialization"\}/)
})
