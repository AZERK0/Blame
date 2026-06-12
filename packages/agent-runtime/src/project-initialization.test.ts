import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectInitializationResult } from "./project-initialization.js";

const baseResult = {
  setupScript: "set -euo pipefail",
  dockerCompose: [
    "services:",
    "  web:",
    "    image: node:22",
    '    user: "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
    "    ports:",
    '      - "127.0.0.1::3000"',
  ].join("\n"),
  runConfigurations: [
    {
      id: "web",
      name: "Web application",
      command: "pnpm dev",
      cwd: ".",
      default: true,
    },
  ],
  practices: [
    { practice: "coding_style", detected: false, comment: "Not detected." },
    { practice: "unit_tests", detected: false, comment: "Not detected." },
    { practice: "layered_architecture", detected: false, comment: "Not detected." },
    { practice: "commit_message_convention", detected: false, comment: "Not detected." },
  ],
};

test("parses project run configurations", () => {
  const result = parseProjectInitializationResult(JSON.stringify(baseResult));

  assert.deepEqual(result.runConfigurations, baseResult.runConfigurations);
});

test("rejects run configuration cwd outside the project", () => {
  const result = {
    ...baseResult,
    runConfigurations: [{ ...baseResult.runConfigurations[0], cwd: "../outside" }],
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /cwd must stay inside the project/,
  );
});

test("rejects duplicate compose mapping keys", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  web:",
      "    image: node:22",
      "    environment:",
      '      CI: "true"',
      '    user: "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
      "    environment:",
      '      HOST: "0.0.0.0"',
      "    ports:",
      '      - "127.0.0.1::3000"',
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /duplicate YAML key "environment"/,
  );
});

test("rejects fixed localhost public origins with dynamic preview ports", () => {
  const result = {
    ...baseResult,
    setupScript: "export BETTER_AUTH_URL=\"http://localhost:3000\"",
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must not set browser-facing origin URLs/,
  );
});

test("rejects setup scripts requiring Docker", () => {
  const result = {
    ...baseResult,
    setupScript: "command -v docker >/dev/null || exit 1",
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must not require Docker/,
  );
});

test("rejects numeric su users in compose commands", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  deps:",
      "    image: node:22",
      '    user: "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
      "    ports:",
      '      - "127.0.0.1::3000"',
      "    command: bash -lc \"su -s /bin/bash -c 'corepack pnpm install' '#${BLAME_HOST_UID}'\"",
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must not run commands through su/,
  );
});

test("rejects npm ci in compose previews", () => {
  const result = {
    ...baseResult,
    dockerCompose: [
      "services:",
      "  deps:",
      "    image: node:22",
      '    user: "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
      "    ports:",
      '      - "127.0.0.1::3000"',
      "    command: npm ci",
    ].join("\n"),
  };

  assert.throws(
    () => parseProjectInitializationResult(JSON.stringify(result)),
    /must use npm install --no-package-lock/,
  );
});
