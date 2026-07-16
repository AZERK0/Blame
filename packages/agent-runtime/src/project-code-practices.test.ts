import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  parseProjectCodePracticesResult,
  projectCodePracticesPrompt,
  resolveProjectCodePracticesResult,
} from "./project-code-practices.js";
import { scanProjectCodePractices } from "./project-code-practices-scan.js";

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

test("detects the commit convention when conventional commits are the majority", () => {
  const result = resolveProjectCodePracticesResult(
    { practices },
    commitEvidence(36, 40),
  );
  const convention = result.find(
    ({ practice }) => practice === "commit_message_convention",
  );

  assert.equal(convention?.detected, true);
  assert.equal(
    convention?.comment,
    "36 of 40 evaluated commits use Conventional Commits, so the majority follows the convention.",
  );
});

test("does not detect the commit convention without a strict majority", () => {
  const result = resolveProjectCodePracticesResult(
    { practices },
    commitEvidence(20, 40),
  );
  const convention = result.find(
    ({ practice }) => practice === "commit_message_convention",
  );

  assert.equal(convention?.detected, false);
});

test("scans nested manifests, configurations, tests, and source evidence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "blame-code-practices-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  await writeProjectFixture(root, {
    "package.json": JSON.stringify({ scripts: { test: "pnpm -r test" } }),
    "packages/api/package.json": JSON.stringify({
      scripts: { test: "node --test" },
    }),
    "packages/api/eslint.config.js":
      "export default [{ rules: { eqeqeq: 'error' } }]",
    "packages/api/src/application/create-order-service.ts":
      "export function createOrder() { return { id: 'order' } }",
    "packages/api/src/application/create-order-service.test.ts":
      "import test from 'node:test'; test('creates an order', () => {})",
    "packages/web/src/button.spec.tsx": "export const buttonTest = true",
    "packages/web/src/button.tsx":
      "export function Button() { return <button /> }",
  });

  const scan = await scanProjectCodePractices(root);

  assert.equal(scan.tests.fileCount, 2);
  assert.ok(
    scan.tests.paths.includes(
      "packages/api/src/application/create-order-service.test.ts",
    ),
  );
  assert.ok("packages/api/package.json" in scan.manifests);
  assert.ok("packages/api/eslint.config.js" in scan.configurations);
  assert.ok(
    scan.inventory.architecturePaths.includes(
      "packages/api/src/application/create-order-service.ts",
    ),
  );
  assert.ok(
    scan.source.representativePaths.includes("packages/web/src/button.tsx"),
  );
  assert.match(projectCodePracticesPrompt(scan), /"fileCount":2/);
});

async function writeProjectFixture(
  root: string,
  files: Record<string, string>,
) {
  await Promise.all(
    Object.entries(files).map(async ([path, content]) => {
      const target = join(root, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
}

function commitEvidence(conventionalCount: number, evaluatedCount: number) {
  return {
    conventionalCount,
    evaluatedCount,
    conventionalRatio: conventionalCount / evaluatedCount,
    messages: [],
    nonConventionalMessages: [],
  };
}
