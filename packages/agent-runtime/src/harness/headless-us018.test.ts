import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentToolContext } from "@cline/sdk";
import { BlameAgentRuntime } from "../cline-runtime.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import { ExternalReadGovernor } from "./external-read-governor.js";
import { createInitialTaskBriefing } from "./initial-task-briefing.js";
import { harnessSuccess } from "./protocol.js";
import { RunLifecycleRegistry } from "./run-lifecycle.js";
import { localSemanticWorkspaceExecutor } from "./semantic-executor.js";

test("US-018 keeps novel reads available regardless of the current iteration", () => {
  const governor = new HarnessCostGovernor(80, false);
  governor.after("search_code", { query: "project" }, successfulRead(), {
    iteration: 8,
  });

  const inspect = governor.before(
    "inspect_code",
    "epoch",
    { target: { path: "src/app.ts" }, view: "raw" },
    0,
  );

  assert.equal(inspect, undefined);
  assert.deepEqual(governor.metrics(0).alerts, [
    "NO_MUTATION_AFTER_8_ITERATIONS",
  ]);
});

test("US-018 low-novelty observations advise without blocking a new target", () => {
  const governor = new HarnessCostGovernor(80, false);
  for (let iteration = 1; iteration <= 2; iteration += 1) {
    governor.after(
      "inspect_code",
      { target: { path: `src/known-${iteration}.ts` } },
      harnessSuccess({
        data: { new_bytes: 4, overlap_rate: 0.95 },
        provenance: [],
        revision: {},
        startedAt: Date.now(),
      }),
      { iteration },
    );
  }

  assert.equal(
    governor.before("search_code", "epoch", { query: "unresolved-route" }, 3),
    undefined,
  );
});

test("US-018 suppresses only dependency probes proven equivalent and absent", () => {
  const governor = new HarnessCostGovernor(80, false);
  const first = governor.before(
    "inspect_code",
    "epoch",
    { target: { path: "node_modules/three/package.json" }, view: "raw" },
    1,
  );
  assert.equal(first, undefined);

  governor.after(
    "inspect_code",
    { target: { path: "node_modules/three/package.json" }, view: "raw" },
    harnessSuccess({
      data: {
        diagnostics: [{ code: "DEPENDENCY_MISSING", dependency: "three" }],
      },
      provenance: [],
      revision: {},
      startedAt: Date.now(),
    }),
    { iteration: 1 },
  );
  const repeatedVariant = governor.before(
    "inspect_code",
    "epoch",
    { target: { path: "node_modules/three/src/index.ts" }, view: "raw" },
    2,
  );

  assert.equal(repeatedVariant?.outcome, "unavailable");
  assert.equal(
    record(repeatedVariant?.diagnostics?.[0]).code,
    "ABSENT_PACKAGE_PATH_SUPPRESSED",
  );
});

test("US-018 caches equivalent documentation requests without blocking new questions", async () => {
  const external = new ExternalReadGovernor();
  let executions = 0;
  const fetch = external.wrap({
    name: "fetch_web_content",
    description: "fetch",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return { output: "documentation" };
    },
  });

  await fetch.execute(
    {
      requests: [
        { url: "https://docs.example.test/prisma.md", prompt: "generator" },
      ],
    },
    toolContext(1),
  );
  const newQuestion = await fetch.execute(
    {
      requests: [
        { url: "https://docs.example.test/prisma", prompt: "adapter" },
      ],
    },
    toolContext(2),
  );
  const duplicate = await fetch.execute(
    {
      requests: [
        {
          url: "https://docs.example.test/prisma?utm_source=test",
          prompt: "generator",
        },
      ],
    },
    toolContext(3),
  );
  const distinct = await fetch.execute(
    {
      requests: [
        { url: "https://docs.example.test/three", prompt: "renderer" },
      ],
    },
    toolContext(4),
  );

  assert.equal(record(newQuestion).reason, "EXTERNAL_READ_COMPLETED");
  assert.equal(record(duplicate).reason, "REPEATED_EXTERNAL_READ");
  assert.equal(record(distinct).reason, "EXTERNAL_READ_COMPLETED");
  assert.equal(executions, 3);
});

test("US-022 exposes missing documentation and caches its URL", async () => {
  const external = new ExternalReadGovernor();
  let executions = 0;
  const fetch = external.wrap({
    name: "fetch_web_content",
    description: "fetch",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return {
        output: [
          {
            query: "https://docs.example.test/missing",
            result: "HTTP 404 Not Found",
            success: false,
          },
        ],
        isError: false,
      };
    },
  });
  const first = record(
    await fetch.execute(
      {
        requests: [
          { url: "https://docs.example.test/missing", prompt: "generator" },
        ],
      },
      toolContext(1),
    ),
  );
  const repeated = record(
    await fetch.execute(
      {
        requests: [
          { url: "https://docs.example.test/missing", prompt: "adapter" },
        ],
      },
      toolContext(2),
    ),
  );

  assert.equal(first.outcome, "blocked");
  assert.equal(first.reason, "WEB_CONTENT_NOT_FOUND");
  assert.equal(first.isError, false);
  assert.equal(repeated.reason, "REPEATED_EXTERNAL_READ");
  assert.equal(executions, 1);
});

test("US-018 injects a compact backend-oriented task briefing before reasoning", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-us018-briefing-"));
  try {
    await createBriefingFixture(root);
    const taskContract = {
      session_id: "us018-briefing",
      objective: "Build 3D Project Carousel Backend",
    };
    const briefing = await createInitialTaskBriefing({
      executor: localSemanticWorkspaceExecutor(root, taskContract),
      taskContract,
      workspaceRoot: root,
    });
    assert.ok(briefing);
    assert.ok(Buffer.byteLength(briefing) <= 4_800);
    const state = record(JSON.parse(briefing));
    assert.ok(record(state.repository));
    assert.ok(record(state.capabilities));
    assert.equal(record(state.task_contract).objective, taskContract.objective);
    const paths = briefingPaths(briefing);
    assert.ok(paths.includes("app/api/projects/route.ts"));
    assert.ok(paths.includes("prisma/schema.prisma"));
    assert.equal(
      paths.some((path) => path.includes("migrations")),
      false,
    );
    const globalStylesIndex = paths.indexOf("src/globals.css");
    assert.ok(
      globalStylesIndex === -1 ||
        paths.indexOf("app/api/projects/route.ts") < globalStylesIndex,
    );
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("US-018 model inactivity terminates a running execution cleanly", async () => {
  let aborts = 0;
  let stops = 0;
  const core = inactivityCore(
    () => (aborts += 1),
    () => (stops += 1),
  );
  const runtime = new BlameAgentRuntime(undefined, {
    modelInactivityTimeoutMs: 10,
  });
  const internals = runtimeInternals(runtime);
  internals.runLifecycles.begin("inactive", "execution-inactive");
  internals.armSessionInactivityWatchdog(
    "inactive",
    "execution-inactive",
    core,
  );

  await waitFor(
    () => internals.runLifecycles.state("inactive")?.state === "failed",
  );

  assert.equal(internals.runLifecycles.state("inactive")?.state, "failed");
  assert.equal(aborts, 1);
  assert.equal(stops, 1);
});

test("US-018 active tools pause the model inactivity deadline", async () => {
  const core = inactivityCore(
    () => undefined,
    () => undefined,
  );
  const runtime = new BlameAgentRuntime(undefined, {
    modelInactivityTimeoutMs: 15,
  });
  const internals = runtimeInternals(runtime);
  internals.runLifecycles.begin("tool-active", "execution-tool");
  internals.armSessionInactivityWatchdog("tool-active", "execution-tool", core);
  internals.observeSessionActivity(
    "tool-active",
    "execution-tool",
    "started",
    "tool-call",
  );
  internals.observeSessionActivity(
    "tool-active",
    "execution-tool",
    "started",
    "tool-call",
  );

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(internals.runLifecycles.state("tool-active")?.state, "running");

  internals.observeSessionActivity(
    "tool-active",
    "execution-tool",
    "finished",
    "tool-call",
  );
  await waitFor(
    () => internals.runLifecycles.state("tool-active")?.state === "failed",
  );
  assert.equal(internals.runLifecycles.state("tool-active")?.state, "failed");
});

function successfulRead() {
  return harnessSuccess({
    data: { path: "src/app.ts" },
    provenance: [],
    revision: {},
    startedAt: Date.now(),
  });
}

function toolContext(iteration: number) {
  return {
    iteration,
    metadata: { sourceRevisionId: "src_us018" },
  } as AgentToolContext;
}

function inactivityCore(onAbort: () => void, onStop: () => void) {
  return {
    abort: async () => onAbort(),
    getAccumulatedUsage: async () => undefined,
    stop: async () => onStop(),
  } as never;
}

function runtimeInternals(runtime: BlameAgentRuntime) {
  return runtime as unknown as {
    armSessionInactivityWatchdog(
      sessionId: string,
      executionId: string,
      core: never,
    ): void;
    observeSessionActivity(
      sessionId: string,
      executionId: string,
      phase?: "started" | "finished",
      toolCallId?: string,
    ): void;
    runLifecycles: RunLifecycleRegistry;
  };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function createBriefingFixture(root: string) {
  await Promise.all([
    mkdir(join(root, "app", "api", "projects"), { recursive: true }),
    mkdir(join(root, "prisma", "migrations", "old-project"), {
      recursive: true,
    }),
    mkdir(join(root, "src"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { build: "next build", typecheck: "tsc --noEmit" },
        dependencies: {
          "@prisma/client": "^7.0.0",
          next: "^16.0.0",
          prisma: "^7.0.0",
          three: "^0.180.0",
        },
      }),
    ),
    writeFile(
      join(root, "app", "api", "projects", "route.ts"),
      "export async function GET() { return Response.json({ projects: [] }); }\n",
    ),
    writeFile(
      join(root, "prisma", "schema.prisma"),
      "model Project { id String @id title String }\n",
    ),
    writeFile(
      join(root, "prisma", "migrations", "old-project", "migration.sql"),
      "CREATE TABLE Project (id TEXT PRIMARY KEY);\n",
    ),
    writeFile(join(root, "src", "globals.css"), ".project-card {}\n"),
  ]);
}

function briefingPaths(value: string) {
  const parsed = record(JSON.parse(value));
  const projection = record(parsed.task_projection);
  const targets = Array.isArray(projection.relevant_targets)
    ? projection.relevant_targets
    : [];
  return targets
    .map((target) => record(target).path)
    .filter((path): path is string => typeof path === "string");
}
