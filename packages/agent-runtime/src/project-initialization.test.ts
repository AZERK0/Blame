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
