import assert from "node:assert/strict";
import test from "node:test";
import {
  codeReviewGraphMcpArgs,
  CodeReviewGraphService,
  parseCodeReviewGraphStatus,
  parseDetectChangesOutput,
  resolveCodeReviewGraphCommand,
} from "./code-review-graph.ts";

test("builds the code-review-graph MCP command arguments", () => {
  assert.deepEqual(codeReviewGraphMcpArgs("/repo"), [
    "serve",
    "--repo",
    "/repo",
    "--tools",
    "get_minimal_context_tool,get_impact_radius_tool,get_review_context_tool,get_architecture_overview_tool,list_graph_stats_tool",
  ]);
});

type ServiceFixtureInput = {
  commands?: string[][];
  dirty?: boolean;
  graphExists?: boolean;
  head?: string;
  run?: (
    args: string[],
    worktree: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<{ stderr: string; stdout: string }>;
  statusText?: string;
};

test("resolves the default command from PATH", () => {
  assert.deepEqual(resolveCodeReviewGraphCommand({}), {
    args: [],
    command: "code-review-graph",
    source: "path",
  });
});

test("resolves an explicit command and args from the environment", () => {
  assert.deepEqual(
    resolveCodeReviewGraphCommand({
      BLAME_CODE_REVIEW_GRAPH_ARGS: '["--isolated"]',
      BLAME_CODE_REVIEW_GRAPH_COMMAND: "/opt/bin/crg",
    }),
    {
      args: ["--isolated"],
      command: "/opt/bin/crg",
      source: "env",
    },
  );
});

test("parses code-review-graph status output", () => {
  const parsed = parseCodeReviewGraphStatus(statusOutput("abc"));

  assert.equal(parsed.nodes, 12);
  assert.equal(parsed.edges, 34);
  assert.equal(parsed.files, 5);
  assert.deepEqual(parsed.languages, ["typescript", "tsx"]);
  assert.equal(parsed.builtCommit, "abc");
});

test("parses detect-changes JSON into a compact payload", () => {
  const parsed = parseDetectChangesOutput(
    JSON.stringify({
      changed_functions: [{ file_path: "src/a.ts", line_start: 1, name: "a" }],
      context_savings: { saved_percent: 90 },
      risk_score: 0.5,
      summary: "Analyzed 1 changed file.",
      test_gaps: [{ file: "src/a.ts", name: "a" }],
    }),
  ) as Record<string, unknown>;

  assert.equal(parsed.summary, "Analyzed 1 changed file.");
  assert.equal(parsed.risk, 0.5);
  assert.deepEqual(parsed.contextSavings, { saved_percent: 90 });
});

test("reports missing when the command is unavailable", async () => {
  const service = serviceFixture({
    run: async () => {
      throw Object.assign(new Error("spawn code-review-graph ENOENT"), {
        code: "ENOENT",
      });
    },
  });

  const status = await service.status({ worktree: "/repo" });

  assert.equal(status.state, "missing");
  assert.equal(status.available, false);
});

test("reports ready when graph commit and worktree snapshot match", async () => {
  const service = serviceFixture();

  const status = await service.status({ worktree: "/repo" });

  assert.equal(status.state, "ready");
  assert.equal(status.nodes, 12);
});

test("accepts short graph commits when they match the full git commit", async () => {
  const service = serviceFixture({ head: "abcdef1234567890" });

  const status = await service.status({ worktree: "/repo" });

  assert.equal(status.state, "ready");
});

test("reports stale when the graph was built for another commit", async () => {
  const service = serviceFixture({ head: "def" });

  const status = await service.status({ worktree: "/repo" });

  assert.equal(status.state, "stale");
  assert.match(status.staleReason ?? "", /different commit/);
});

test("skips update when graph is already fresh", async () => {
  const commands: string[][] = [];
  const service = serviceFixture({ commands });

  const result = await service.update({ worktree: "/repo" });

  assert.equal(result.action, "skipped");
  assert.equal(
    commands.some((args) => args[0] === "update"),
    false,
  );
  assert.equal(
    commands.some((args) => args[0] === "build"),
    false,
  );
});

test("does not rebuild again after updating a dirty worktree snapshot", async () => {
  const commands: string[][] = [];
  const service = serviceFixture({
    commands,
    dirty: true,
    statusText: " M src/a.ts",
  });

  const first = await service.update({ worktree: "/repo" });
  const second = await service.update({ worktree: "/repo" });

  assert.equal(first.action, "updated");
  assert.equal(second.action, "skipped");
  assert.equal(commands.filter((args) => args[0] === "update").length, 1);
});

test("queries minimal context through MCP", async () => {
  const service = serviceFixture();

  const result = await service.minimalContext({
    task: "debug login",
    worktree: "/repo",
  });

  assert.equal(result.state, "ready");
  assert.equal(result.source, "mcp");
  assert.deepEqual(result.data, { status: "ok", summary: "ok" });
});

function serviceFixture(input: ServiceFixtureInput = {}) {
  const commands = input.commands ?? [];
  return new CodeReviewGraphService({
    availabilityTtlMs: 0,
    command: () => ({ args: [], command: "code-review-graph", source: "path" }),
    createMcpClient: () => mcpClient(),
    graphPathExists: async () => input.graphExists ?? true,
    now: () => Date.now(),
    run: input.run ?? fixtureRun(commands),
    snapshot: async () => fixtureSnapshot(input),
  });
}

function fixtureRun(commands: string[][]) {
  return async (args: string[]) => {
    commands.push(args);
    if (args[0] === "--version")
      return { stderr: "", stdout: "code-review-graph 2.3.6\n" };
    if (args[0] === "status")
      return { stderr: "", stdout: statusOutput("abc") };
    if (["update", "build", "postprocess"].includes(args[0]))
      return { stderr: "", stdout: "updated\n" };
    return {
      stderr: "",
      stdout: JSON.stringify({ summary: "Analyzed changes." }),
    };
  };
}

function fixtureSnapshot(input: ServiceFixtureInput) {
  return {
    branch: "main",
    dirty: input.dirty ?? false,
    fingerprint: JSON.stringify({
      branch: "main",
      head: input.head ?? "abc",
      status: input.statusText ?? "",
    }),
    head: input.head ?? "abc",
  };
}

function mcpClient() {
  return {
    async callTool() {
      return { status: "ok", summary: "ok" };
    },
    async close() {},
  };
}

function statusOutput(commit: string) {
  return [
    "Nodes: 12",
    "Edges: 34",
    "Files: 5",
    "Languages: typescript, tsx",
    "Last updated: 2026-06-18T02:31:59",
    "Built on branch: main",
    `Built at commit: ${commit}`,
  ].join("\n");
}
