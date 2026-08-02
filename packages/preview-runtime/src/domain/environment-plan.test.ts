import assert from "node:assert/strict";
import test from "node:test";
import { mergeEnvironmentPlan, type EnvironmentPlanEntry } from "./environment-plan.js";

test("applies runtime, story, project, account, then manifest precedence", () => {
  const entry = (source: EnvironmentPlanEntry["source"]): EnvironmentPlanEntry => ({
    key: "API_URL",
    scope: "ssr",
    classification: "non-secret",
    delivery: "literal",
    source,
    serviceId: "web",
    snapshot: "never",
  });
  const plan = mergeEnvironmentPlan([
    entry("manifest"), entry("account"), entry("project"), entry("story"), entry("runtime-binding"),
  ]);
  assert.equal(plan.entries[0]?.source, "runtime-binding");
  assert.equal(plan.cleanupRequired, true);
});
