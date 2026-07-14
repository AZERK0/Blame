import assert from "node:assert/strict";
import test from "node:test";
import { repositoryTelemetryCohorts } from "./repository-telemetry-cohorts.ts";

test("derives bounded repository cohorts without returning file paths", () => {
  const privatePath = "customer/private-feature.ts";
  const cohorts = repositoryTelemetryCohorts(
    [privatePath, "src/page.tsx", "src/api.py", "README.md", ""].join("\0"),
  );
  assert.deepEqual(cohorts, {
    repositoryLanguage: "typescript",
    repositorySizeBucket: "small",
  });
  assert.equal(JSON.stringify(cohorts).includes(privatePath), false);
});

test("uses mixed and bounded size cohorts", () => {
  const files = [
    ...Array.from({ length: 500 }, (_, index) => `src/${index}.ts`),
    ...Array.from({ length: 500 }, (_, index) => `api/${index}.py`),
  ];
  assert.deepEqual(repositoryTelemetryCohorts(`${files.join("\0")}\0`), {
    repositoryLanguage: "mixed",
    repositorySizeBucket: "large",
  });
});
