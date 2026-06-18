import assert from "node:assert/strict";
import test from "node:test";
import { codeReviewGraphTools } from "./code-review-graph-tools.js";
import type { CodeReviewGraphProvider } from "./types.js";

test("does not expose code graph tools without a worktree", () => {
  assert.deepEqual(codeReviewGraphTools(provider(), undefined), []);
});

test("get_code_graph_status calls the provider with the current worktree", async () => {
  const calls: string[] = [];
  const tools = codeReviewGraphTools(provider(calls), "/worktree");
  const tool = tools.find((tool) => tool.name === "get_code_graph_status");
  assert.ok(tool);

  const result = await tool.execute({ waitMs: 123 }, context());

  assert.equal(calls[0], "status:/worktree:123");
  assert.deepEqual(result, {
    available: true,
    state: "ready",
    worktree: "/worktree",
  });
});

test("get_code_impact_radius normalizes compact query input", async () => {
  const calls: string[] = [];
  const tools = codeReviewGraphTools(provider(calls), "/worktree");
  const tool = tools.find((tool) => tool.name === "get_code_impact_radius");
  assert.ok(tool);

  await tool.execute(
    {
      base: "main",
      changedFiles: ["src/a.ts", 7, "src/b.ts"],
      maxDepth: 9,
      waitMs: 100_000,
    },
    context(),
  );

  assert.equal(calls[0], "impact:/worktree:main:src/a.ts,src/b.ts:4:60000");
});

test("get_code_minimal_context passes the task and current worktree", async () => {
  const calls: string[] = [];
  const tools = codeReviewGraphTools(provider(calls), "/worktree");
  const tool = tools.find((tool) => tool.name === "get_code_minimal_context");
  assert.ok(tool);

  await tool.execute({ task: "debug login", waitMs: 100_000 }, context());

  assert.equal(calls[0], "minimal:/worktree:debug login:60000");
});

function provider(calls: string[] = []): CodeReviewGraphProvider {
  return {
    async architectureOverview(input) {
      calls.push(`architecture:${input.worktree}:${input.detailLevel}`);
      return { available: true, state: "ready", worktree: input.worktree };
    },
    async impactRadius(input) {
      calls.push(
        [
          "impact",
          input.worktree,
          input.base,
          input.changedFiles?.join(","),
          input.maxDepth,
          input.waitMs,
        ].join(":"),
      );
      return { available: true, state: "ready", worktree: input.worktree };
    },
    async minimalContext(input) {
      calls.push(`minimal:${input.worktree}:${input.task}:${input.waitMs}`);
      return { available: true, state: "ready", worktree: input.worktree };
    },
    async reviewContext(input) {
      calls.push(`review:${input.worktree}:${input.includeSource}`);
      return { available: true, state: "ready", worktree: input.worktree };
    },
    async status(input) {
      calls.push(`status:${input.worktree}:${input.waitMs}`);
      return { available: true, state: "ready", worktree: input.worktree };
    },
    async update(input) {
      calls.push(`update:${input.worktree}:${input.force}`);
      return {
        action: "updated",
        available: true,
        state: "ready",
        worktree: input.worktree,
      };
    },
  };
}

function context() {
  return {
    agentId: "agent",
    iteration: 1,
  };
}
