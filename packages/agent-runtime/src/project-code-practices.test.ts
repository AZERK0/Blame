import assert from "node:assert/strict";
import test from "node:test";

import { parseProjectCodePracticesResult } from "./project-code-practices.js";

const practices = [
  { practice: "unit_tests", detected: true, comment: "Tests are configured." },
  {
    practice: "coding_style",
    detected: false,
    comment: "Strict linting is not configured.",
  },
  {
    practice: "commit_message_convention",
    detected: true,
    comment: "Recent commits use Conventional Commits.",
  },
  {
    practice: "layered_architecture",
    detected: false,
    comment: "Dependency boundaries are not enforced.",
  },
];

test("parses every required project code practice", () => {
  const result = parseProjectCodePracticesResult({ practices });

  assert.deepEqual(
    result.map(({ practice }) => practice),
    [
      "coding_style",
      "unit_tests",
      "layered_architecture",
      "commit_message_convention",
    ],
  );
});

test("rejects incomplete project code practice results", () => {
  assert.throws(
    () => parseProjectCodePracticesResult({ practices: practices.slice(0, 3) }),
    /exactly four/,
  );
});

test("rejects extra project code practice results", () => {
  assert.throws(
    () =>
      parseProjectCodePracticesResult({
        practices: [...practices, practices[0]],
      }),
    /exactly four/,
  );
});
