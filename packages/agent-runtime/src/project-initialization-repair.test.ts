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
    }),
  )

  assert.equal(result.classification, "repairable_initialization")
  assert.equal(result.dockerCompose, validCompose)
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
        }),
      ),
    /Docker-allocated host ports/,
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
