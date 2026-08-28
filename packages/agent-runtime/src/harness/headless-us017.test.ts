import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentToolContext } from "@cline/sdk";
import { BlameAgentRuntime } from "../cline-runtime.js";
import { blameSpecialistAgentIds } from "../specialist-agents.js";
import { createConsultSpecialistTool } from "../specialist-consult-tool.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import { ExternalReadGovernor } from "./external-read-governor.js";
import {
  harnessSuccess,
  type HarnessToolResult,
  type HarnessToolSuccess,
} from "./protocol.js";
import { ReadWorkingSet } from "./read-working-set.js";
import { RunLifecycleRegistry } from "./run-lifecycle.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import { compactWorkspaceStateResult } from "./workspace-state-output.js";
import type {
  DependencyExecutorCapability,
  TaskExecutionInput,
  TaskExecutionResult,
  TaskExecutor,
} from "./task-executor.js";

test("US-017 validates the dependency target before executor availability", async () => {
  await withUs017Workspace(async (root) => {
    const executor = new UnavailableExecutor();
    const workspace = workspaceWith(root, "target-order", executor);
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    executor.capabilityChecks = 0;
    const result = await workspace.mutateDependencies(
      dependencyMutation(revision, "apps/api/package.json"),
    );
    assert.equal(result.status, "error");
    if (result.status !== "error") assert.fail("Expected a recoverable error.");
    assert.equal(result.outcome, "failed");
    assert.equal(result.fatal, false);
    assert.equal(result.reason, "TARGET_NOT_FOUND");
    assert.equal(executor.capabilityChecks, 0);
  });
});

test("US-017 common outcomes never claim completion or application when applied is false", () => {
  const inconsistent = harnessSuccess({
    data: { applied: false, outcome: "applied" },
    provenance: [],
    revision: {},
    startedAt: Date.now(),
  });
  const unchanged = harnessSuccess({
    data: { applied: false },
    provenance: [],
    revision: {},
    startedAt: Date.now(),
  });
  assert.equal(inconsistent.outcome, "blocked");
  assert.equal(unchanged.outcome, "skipped");
});

test("US-017 available dependencies are applied by pnpm with its generated lockfile", async () => {
  await withUs017Workspace(async (root) => {
    const executor = new PnpmExecutor();
    const workspace = workspaceWith(root, "pnpm-applied", executor);
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    const result = success(
      await workspace.mutateDependencies(dependencyMutation(revision)),
    );
    assert.equal(result.outcome, "applied");
    assert.ok("status" in result.data && result.data.status === "applied");
    assert.deepEqual(executor.lastInput?.args, [
      "install",
      "--lockfile-only",
      "--prefer-offline",
      "--ignore-scripts",
    ]);
    assert.equal(executor.lastInput?.packageManager, "pnpm");
    assert.equal(
      await readFile(join(root, "pnpm-lock.yaml"), "utf8"),
      "lockfile-generated-by-pnpm\n",
    );
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    assert.equal(manifest.dependencies.kleur, "^4.1.5");
  });
});

test("US-017 workspace state keeps relevant detail compact and pages every manifest dependency", async () => {
  await withUs017Workspace(async (root) => {
    await mkdir(join(root, "apps", "api"), { recursive: true });
    const generatedDependencies = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [
        `fixture-dependency-${index}`,
        `^${index + 1}.0.0`,
      ]),
    );
    await writeFile(
      join(root, "apps", "api", "package.json"),
      JSON.stringify({
        dependencies: {
          ...generatedDependencies,
          "@nestjs/core": "^11.0.0",
          "@prisma/client": "^7.0.0",
          three: "^0.180.0",
        },
        name: "api",
        scripts: { build: "nest build", test: "node --test" },
      }),
    );
    const workspace = workspaceWith(
      root,
      "state-exhaustive",
      new UnavailableExecutor(),
    );
    const state = success(await workspace.workspaceState());
    const compact = success(compactWorkspaceStateResult(state));
    const compactData = record(compact.data);
    const projection = record(compactData.task_projection);
    const inventory = record(projection.dependency_inventory);
    const manifests = inventory.manifests as Array<Record<string, unknown>>;
    const compactApi = manifests.find(
      (manifest) => manifest.path === "apps/api/package.json",
    );
    assert.ok(compactApi);
    assert.equal(compactApi.detail, "paginated");
    assert.equal(compactApi.dependencies, undefined);
    const pagination = record(projection.pagination);
    const manifestPageReceipt = record(pagination.manifests);
    const manifestCursor = String(manifestPageReceipt.next_cursor);
    assert.match(manifestCursor, /^wsm_[a-f0-9]{10}_0$/u);
    const page = success(
      compactWorkspaceStateResult(state, undefined, {
        cursor: manifestCursor,
        pageSize: 10,
      }),
    );
    const pageProjection = record(record(page.data).task_projection);
    const pageInventory = record(pageProjection.dependency_inventory);
    const pageManifests = pageInventory.manifests as Array<
      Record<string, unknown>
    >;
    const api = pageManifests.find(
      (manifest) => manifest.path === "apps/api/package.json",
    );
    assert.ok(api);
    assert.equal((api.dependencies as unknown[]).length, 33);
    assert.deepEqual(
      (api.scripts as Array<{ name: string }>).map(({ name }) => name),
      ["build", "test"],
    );
    assert.equal((projection.packages as unknown[]).length, 2);
    assert.deepEqual(projection.detected_frameworks, [
      "NestJS",
      "Prisma",
      "React",
      "Three.js",
    ]);
    const capabilities = record(compactData.capabilities);
    const mutation = record(record(capabilities.dependency_mutation));
    assert.equal(mutation.package_manager, "pnpm");
    assert.equal(mutation.package_manager_version, "10.32.1");
    assert.equal(mutation.registry_policy, "configured_only");
    assert.equal(typeof mutation.cache_available, "boolean");
    assert.ok(record(capabilities.run_task));
    assert.ok(record(capabilities.network));
    assert.ok(Buffer.byteLength(JSON.stringify(compact), "utf8") < 32_000);
    const stalePage = success(
      compactWorkspaceStateResult(state, undefined, {
        cursor: "wsm_0000000000_0",
      }),
    );
    assert.equal(stalePage.outcome, "unavailable");
    assert.equal(stalePage.reason, "STALE_WORKSPACE_STATE_CURSOR");
  });
});

test("US-017 unavailable dependencies return only actionable non-fatal data and open the exploration circuit", async () => {
  await withUs017Workspace(async (root) => {
    const workspace = workspaceWith(
      root,
      "dependency-unavailable",
      new UnavailableExecutor(),
    );
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    const unavailable = success(
      await workspace.mutateDependencies(dependencyMutation(revision)),
    );
    assert.equal(unavailable.outcome, "unavailable");
    assert.equal(unavailable.fatal, false);
    assert.deepEqual(Object.keys(unavailable.data).sort(), [
      "dependencies_already_available",
      "reason",
      "strategies",
    ]);
    if (!("dependencies_already_available" in unavailable.data))
      assert.fail("Expected an unavailable dependency receipt.");
    assert.deepEqual(
      unavailable.data.dependencies_already_available.map(({ name }) => name),
      ["react"],
    );

    const governor = new ExternalReadGovernor();
    const mutationTool = governor.wrap({
      name: "mutate_dependencies",
      description: "mutation",
      inputSchema: { type: "object" },
      execute: async () => unavailable,
    });
    await mutationTool.execute({}, toolContext(1));
    let externalExecutions = 0;
    const fetch = governor.wrap({
      name: "fetch_web_content",
      description: "fetch",
      inputSchema: { type: "object" },
      execute: async () => {
        externalExecutions += 1;
        return { output: "npm metadata" };
      },
    });
    for (let iteration = 2; iteration <= 3; iteration += 1) {
      const receipt = await fetch.execute(
        { query: "npm install package and rebuild the lockfile" },
        toolContext(iteration),
      );
      assert.equal(record(receipt).outcome, "unavailable");
      assert.equal(record(receipt).isError, false);
    }
    assert.equal(externalExecutions, 0);

    const costGovernor = new HarnessCostGovernor(80, false);
    costGovernor.after("mutate_dependencies", {}, unavailable, {
      iteration: 1,
    });
    const lockfileSearch = costGovernor.before(
      "search_code",
      "dependency-epoch",
      { path: "pnpm-lock.yaml", query: { kind: "text", pattern: "react" } },
      2,
    );
    assert.equal(lockfileSearch?.outcome, "skipped");
    assert.equal(lockfileSearch?.reason, "LOCKFILE_RECONSTRUCTION_SUPPRESSED");
    costGovernor.newUserRequest();
    assert.equal(
      costGovernor.before(
        "search_code",
        "next-request",
        { query: { kind: "text", pattern: "pnpm-lock.yaml" } },
        1,
      )?.reason,
      "LOCKFILE_RECONSTRUCTION_SUPPRESSED",
    );
    assert.equal(
      costGovernor.before(
        "search_code",
        "next-request",
        { query: { kind: "text", pattern: "dependency service" } },
        2,
      ),
      undefined,
    );
  });
});

test("US-017 external reads deduplicate canonical URLs per batch resource without semantic false positives", async () => {
  const governor = new ExternalReadGovernor();
  let executions = 0;
  const fetch = governor.wrap({
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
        { url: "https://docs.example.test/pkg.md?utm_source=agent#api" },
        { url: "https://docs.example.test/other" },
      ],
    },
    toolContext(1),
  );
  const duplicate = await fetch.execute(
    { requests: [{ url: "https://docs.example.test/pkg" }] },
    toolContext(2),
  );
  const nearby = await fetch.execute(
    { requests: [{ url: "https://docs.example.test/pkg-reference" }] },
    toolContext(3),
  );
  assert.equal(record(duplicate).outcome, "skipped");
  assert.equal(record(duplicate).reason, "REPEATED_EXTERNAL_READ");
  assert.equal(record(duplicate).isError, false);
  assert.match(
    String(record(duplicate).previous_receipt),
    /^external-read:\/\//u,
  );
  assert.equal(record(nearby).outcome, "completed");
  assert.equal(executions, 2);
});

test("US-017 recoverable failures in an external batch stay non-fatal and preserve every item", async () => {
  const governor = new ExternalReadGovernor();
  const fetch = governor.wrap({
    name: "fetch_web_content",
    description: "fetch",
    inputSchema: { type: "object" },
    execute: async () => ({
      isError: true,
      output: [
        { query: "https://example.test/available", success: true },
        { query: "https://example.test/missing", status: 404, success: false },
      ],
    }),
  });
  const result = record(
    await fetch.execute(
      {
        requests: [
          { url: "https://example.test/available" },
          { url: "https://example.test/missing" },
        ],
      },
      toolContext(1),
    ),
  );
  assert.equal(result.outcome, "failed");
  assert.equal(result.fatal, false);
  assert.equal(result.isError, false);
  assert.equal((result.output as unknown[]).length, 2);
  const negativeCache = await fetch.execute(
    { requests: [{ url: "https://example.test/missing" }] },
    toolContext(2),
  );
  assert.equal(record(negativeCache).outcome, "skipped");
});

test("US-017 repeated external reads reduce serialized token proxies by at least seventy percent", async () => {
  const governor = new ExternalReadGovernor();
  const fetch = governor.wrap({
    name: "fetch_web_content",
    description: "fetch",
    inputSchema: { type: "object" },
    execute: async () => ({ output: "x".repeat(12_000) }),
  });
  const outputs: unknown[] = [];
  for (let iteration = 1; iteration <= 10; iteration += 1)
    outputs.push(
      await fetch.execute(
        { url: "https://docs.example.test/large" },
        toolContext(iteration),
      ),
    );
  const firstBytes = serializedBytes(outputs[0]);
  const legacyBytes = firstBytes * outputs.length;
  const governedBytes = outputs.reduce<number>(
    (total, output) => total + serializedBytes(output),
    0,
  );
  assert.ok((legacyBytes - governedBytes) / legacyBytes >= 0.7);
});

test("US-017 no-progress thresholds summarize at four and close only broad or external exploration at eight", () => {
  const governor = new HarnessCostGovernor(80, false);
  let fourth: HarnessToolResult<{ path: string }> | undefined;
  for (let iteration = 1; iteration <= 8; iteration += 1) {
    fourth = governor.after(
      "search_code",
      { query: `fact-${iteration}` },
      harnessSuccess({
        data: { path: `src/fact-${iteration}.ts` },
        provenance: [],
        revision: {},
        startedAt: Date.now(),
      }),
      { contextEpoch: "epoch-0", iteration },
    );
    if (iteration === 4)
      assert.equal(
        fourth.status === "success" &&
          fourth.diagnostics?.some(
            (item) => record(item).code === "CONTEXT_GOVERNOR",
          ),
        true,
      );
  }
  assert.equal(governor.beforeExternal(8)?.outcome, "skipped");
  assert.equal(
    governor.before("inspect_code", "epoch-0", { target: "precise" }, 8),
    undefined,
  );
  assert.deepEqual(governor.metrics(8).alerts, [
    "NO_MUTATION_AFTER_8_ITERATIONS",
  ]);

  const editGovernor = new HarnessCostGovernor(80, false);
  editGovernor.after(
    "replace_file",
    { path: "src/app.ts" },
    harnessSuccess({
      data: { status: "applied" },
      provenance: [],
      revision: {},
      startedAt: Date.now(),
    }),
    { iteration: 5 },
  );
  assert.equal(editGovernor.metrics(5).first_edit_iteration, 5);
});

test("US-017 forced compaction restores the intact objective, architecture, files, changes and validation", async () => {
  await withUs017Workspace(async (root) => {
    const sessionId = "forced-compaction";
    const memory = new ConversationMemoryStore(root, sessionId);
    const started = await memory.beginRequest({
      currentRequest:
        "Préserver intégralement cet objectif utilisateur après compactage.",
      userGoal:
        "Préserver intégralement cet objectif utilisateur après compactage.",
      requestRef: "user://us017",
    });
    const source = Buffer.from("export const value = 1;\n");
    const workingSet = new ReadWorkingSet(root, sessionId);
    await workingSet.register({
      contextEpoch: started.capsule.executionEpochId,
      maximumBytes: source.byteLength,
      path: "src/app.ts",
      range: [0, source.byteLength],
      sourceBlob: "blob-us017",
      sourceContent: source,
      view: "raw",
    });
    await memory.recordOperationalState({
      architecture: ["Architecture: monorepo pnpm avec NestJS et Prisma."],
      nextFocus: "src/app.ts",
      unavailableCapabilities: ["Dependency mutation unavailable."],
    });
    await memory.recordChange({
      files: ["src/app.ts"],
      receiptId: "change://us017",
      sourceRevisionId: "src_us017",
      summary: "Updated the application",
      symbols: ["value"],
      validation: "not_run",
    });
    await memory.recordValidation({
      id: "run://us017",
      status: "passed",
      terminal: "passed",
    });
    await memory.checkpoint();
    await memory.rotate("model_compaction");
    const continuity = await memory.runtimeContinuity();
    assert.equal(
      continuity.activeRequest,
      "Préserver intégralement cet objectif utilisateur après compactage.",
    );
    assert.ok(continuity.decisions.some((item) => item.includes("NestJS")));
    assert.ok(continuity.inspectedFiles.includes("src/app.ts@blob-us017"));
    assert.deepEqual(continuity.modifiedFiles, ["src/app.ts"]);
    assert.match(continuity.validation, /covered/iu);
    assert.match(continuity.nextAction, /src\/app\.ts/iu);
  });
});

test("US-017 stale short references remain recoverable without repeated tool failures", async () => {
  await withUs017Workspace(async (root) => {
    const workspace = workspaceWith(
      root,
      "stale-references",
      new UnavailableExecutor(),
    );
    for (let index = 0; index < 4; index += 1) {
      const stale = await workspace.recallContext({ symbol_ref: "m_zz" });
      if (stale.status !== "success") assert.fail(JSON.stringify(stale));
      assert.equal(stale.outcome, "unavailable");
      assert.equal(stale.reason, "STALE_REFERENCE");
    }
  });
});

test("US-017 read ranges clamp at EOF and reuse an already covered full read", async () => {
  await withUs017Workspace(async (root) => {
    const workspace = workspaceWith(
      root,
      "read-normalization",
      new UnavailableExecutor(),
    );
    const first = success(
      await workspace.inspectCode(
        { target: { path: "src/app.ts" }, view: "raw" },
        undefined,
        { contextEpoch: "read-epoch" },
      ),
    );
    const duplicate = success(
      await workspace.inspectCode(
        {
          target: { path: "src/app.ts" },
          view: "raw",
          range_utf8_bytes: [0, 100_000],
        },
        undefined,
        { contextEpoch: "read-epoch" },
      ),
    );
    assert.equal(first.outcome, "completed");
    assert.equal(duplicate.outcome, "skipped");
    assert.equal(record(duplicate.data).status, "already_available");
  });
});

test("US-017 specialist deduplication keys objective and revision and propagates timeout cancellation", async () => {
  let executions = 0;
  const completed = createConsultSpecialistTool({
    objective: "Review the lifecycle",
    spawnTool: {
      execute: async () => {
        executions += 1;
        return { output: "advice", isError: false };
      },
    },
  });
  const input = {
    specialist: blameSpecialistAgentIds[0],
    task: "Review lifecycle cancellation boundaries.",
  };
  await completed.execute(input, specialistContext("src_one"));
  const repeated = await completed.execute(input, specialistContext("src_one"));
  await completed.execute(input, specialistContext("src_two"));
  assert.equal(record(repeated).outcome, "skipped");
  assert.equal(executions, 2);

  let cancelled = false;
  let timedExecutions = 0;
  const timed = createConsultSpecialistTool({
    objective: "Review a timeout",
    timeoutMs: 10,
    spawnTool: {
      execute: async (_input: unknown, context: AgentToolContext) => {
        timedExecutions += 1;
        if (timedExecutions > 1)
          return { output: "retry advice", isError: false };
        return new Promise((resolve) => {
          context.signal?.addEventListener(
            "abort",
            () => {
              cancelled = true;
              resolve({ output: "cancelled" });
            },
            { once: true },
          );
        });
      },
    },
  });
  const receipt = await timed.execute(input, specialistContext("src_timeout"));
  assert.equal(record(receipt).outcome, "blocked");
  assert.equal(record(receipt).reason, "SPECIALIST_TIMEOUT");
  assert.equal(cancelled, true);
  const retried = await timed.execute(input, specialistContext("src_timeout"));
  const cachedRetry = await timed.execute(
    input,
    specialistContext("src_timeout"),
  );
  assert.equal(record(retried).outcome, "completed");
  assert.equal(record(cachedRetry).outcome, "skipped");
  assert.equal(timedExecutions, 2);
});

test("US-017 lifecycle uses execution CAS and rejects every event and token after terminal state", () => {
  const lifecycle = new RunLifecycleRegistry();
  lifecycle.begin("session", "execution-one");
  assert.equal(
    lifecycle.begin("session", "execution-overlap").execution_id,
    "execution-one",
  );
  const startedAt = performance.now();
  assert.equal(lifecycle.stopping("session", "execution-one"), true);
  assert.equal(lifecycle.accepts("session", "execution-one", 11), false);
  assert.equal(lifecycle.finish("session", "execution-one", "cancelled"), true);
  assert.ok(performance.now() - startedAt < 2_000);
  assert.equal(lifecycle.canInvoke("session", "execution-one"), false);
  assert.equal(lifecycle.accepts("session", "execution-one", 37), false);
  assert.deepEqual(lifecycle.state("session"), {
    execution_id: "execution-one",
    post_stop_events: 2,
    post_stop_tokens: 48,
    session_id: "session",
    state: "cancelled",
    stop_requested_at: lifecycle.state("session")?.stop_requested_at,
    terminal_at: lifecycle.state("session")?.terminal_at,
  });
  lifecycle.begin("session", "execution-two");
  assert.equal(lifecycle.accepts("session", "execution-one", 100), false);
  assert.equal(lifecycle.state("session")?.post_stop_tokens, 0);
  assert.equal(lifecycle.canInvoke("session", "execution-two"), true);
});

test("US-017 runtime abort closes the core execution and persists terminal state in under two seconds", async () => {
  let abortCalls = 0;
  let stopCalls = 0;
  const core = {
    abort: () => {
      abortCalls += 1;
      return new Promise<void>(() => undefined);
    },
    getAccumulatedUsage: async () => undefined,
    stop: async () => {
      stopCalls += 1;
    },
  };
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    abortSession(sessionId: string, humanInitiated: boolean): Promise<void>;
    clines: Map<string, Promise<unknown>>;
    runLifecycles: RunLifecycleRegistry;
    sessionBackendKeys: Map<string, string>;
    sessionExecutionIds: Map<string, string>;
  };
  internals.clines.set("local", Promise.resolve(core));
  internals.sessionBackendKeys.set("runtime-abort", "local");
  internals.sessionExecutionIds.set("runtime-abort", "execution-abort");
  internals.runLifecycles.begin("runtime-abort", "execution-abort");
  const startedAt = performance.now();
  await internals.abortSession("runtime-abort", false);
  const elapsedMs = performance.now() - startedAt;
  assert.equal(abortCalls, 1);
  assert.equal(stopCalls, 1);
  assert.ok(elapsedMs < 2_000);
  assert.equal(
    internals.runLifecycles.state("runtime-abort")?.state,
    "cancelled",
  );
});

test("US-017 terminal events stop Cline before persistence and terminal publication", async () => {
  const order: string[] = [];
  let releaseStop: (() => void) | undefined;
  const core = {
    abort: async () => {
      order.push("abort");
    },
    stop: async () => {
      order.push("stop");
      await new Promise<void>((resolve) => {
        releaseStop = resolve;
      });
    },
  };
  const runtime = new BlameAgentRuntime({
    emit: () => order.push("emit"),
  } as never);
  const internals = runtime as unknown as {
    finalizeStreamTerminal(
      cline: unknown,
      sessionId: string,
      executionId: string,
      terminalState: "succeeded",
      event: unknown,
      display: boolean,
    ): Promise<void>;
    handleSessionEvent(sessionId: string, event: unknown): Promise<void>;
    readUsage(sessionId: string): Promise<undefined>;
    runLifecycles: RunLifecycleRegistry;
  };
  internals.handleSessionEvent = async () => {
    order.push("persist");
  };
  internals.readUsage = async () => undefined;
  internals.runLifecycles.begin("terminal-stream", "execution-terminal");
  const draining = internals.finalizeStreamTerminal(
    core,
    "terminal-stream",
    "execution-terminal",
    "succeeded",
    { type: "done", sessionId: "terminal-stream", payload: {} },
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(
    internals.runLifecycles.state("terminal-stream")?.state,
    "stopping",
  );
  assert.deepEqual([...order].sort(), ["abort", "stop"]);
  releaseStop?.();
  await draining;
  assert.equal(
    internals.runLifecycles.state("terminal-stream")?.state,
    "succeeded",
  );
  assert.equal(order.indexOf("persist") > order.indexOf("stop"), true);
  assert.equal(order.indexOf("emit") > order.indexOf("persist"), true);
});

test("US-017 termination watchdog retries stop before persisting a terminal state", async () => {
  let stopCalls = 0;
  const core = {
    abort: async () => undefined,
    getAccumulatedUsage: async () => undefined,
    stop: async () => {
      stopCalls += 1;
      if (stopCalls === 1) throw new Error("transient stop failure");
    },
  };
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    abortSession(sessionId: string, humanInitiated: boolean): Promise<void>;
    clines: Map<string, Promise<unknown>>;
    runLifecycles: RunLifecycleRegistry;
    sessionBackendKeys: Map<string, string>;
    sessionExecutionIds: Map<string, string>;
  };
  internals.clines.set("local", Promise.resolve(core));
  internals.sessionBackendKeys.set("watchdog-abort", "local");
  internals.sessionExecutionIds.set("watchdog-abort", "execution-watchdog");
  internals.runLifecycles.begin("watchdog-abort", "execution-watchdog");

  await internals.abortSession("watchdog-abort", false);
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(stopCalls, 2);
  assert.equal(
    internals.runLifecycles.state("watchdog-abort")?.state,
    "cancelled",
  );
});

function workspaceWith(
  root: string,
  sessionId: string,
  taskExecutor: TaskExecutor,
) {
  return new SemanticWorkspace(root, {
    taskContract: {
      objective: "Harden the harness after US-017",
      session_id: sessionId,
    },
    taskExecutor,
  });
}

function dependencyMutation(
  sourceRevisionId: string,
  packagePath = "package.json",
) {
  return {
    source_revision_id: sourceRevisionId,
    package_path: packagePath,
    operations: [
      {
        action: "add" as const,
        dependency_type: "dependencies" as const,
        name: "kleur",
        version: "^4.1.5",
      },
    ],
    timeout_ms: 30_000,
  };
}

function success<T>(result: HarnessToolResult<T>): HarnessToolSuccess<T> {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function serializedBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value) ?? String(value), "utf8");
}

function toolContext(iteration: number) {
  return {
    iteration,
    metadata: { sourceRevisionId: "src_us017" },
  } as AgentToolContext;
}

function specialistContext(sourceRevisionId: string) {
  return {
    iteration: 1,
    metadata: { sourceRevisionId },
  } as AgentToolContext;
}

class UnavailableExecutor implements TaskExecutor {
  capabilityChecks = 0;

  capability() {
    return Promise.resolve("worktree" as const);
  }

  dependencyCapability(): Promise<DependencyExecutorCapability> {
    this.capabilityChecks += 1;
    return Promise.resolve({
      available: false,
      network: "cache_only",
      reason: "DEPENDENCY_EXECUTOR_UNAVAILABLE:no configured registry route",
    });
  }

  execute(): Promise<TaskExecutionResult> {
    throw new Error("The unavailable executor must never run.");
  }
}

class PnpmExecutor implements TaskExecutor {
  lastInput?: TaskExecutionInput;

  capability() {
    return Promise.resolve("worktree" as const);
  }

  dependencyCapability(): Promise<DependencyExecutorCapability> {
    return Promise.resolve({
      available: true,
      network: "managed_allowlist",
    });
  }

  healthCheck() {
    return Promise.resolve({ available: true, isolation: "worktree" as const });
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    this.lastInput = input;
    await writeFile(
      join(input.overlayRoot, "pnpm-lock.yaml"),
      "lockfile-generated-by-pnpm\n",
    );
    return {
      exitCode: 0,
      isolation: "worktree",
      outputTruncated: false,
      packageManagerResolution: {
        name: "pnpm",
        requestedVersion: "10.32.1",
        resolvedVersion: "10.33.2",
        strategy: "compatible_same_major",
      },
      signal: null,
      status: "passed",
      stderr: "",
      stdout: "",
    };
  }
}

async function withUs017Workspace(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-us017-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19.0.0" },
        name: "us017-fixture",
        packageManager: "pnpm@10.32.1",
        scripts: { test: "node --test", typecheck: "tsc --noEmit" },
      }),
    );
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\npackages:\n  react@19.0.0: {}\n",
    );
    await writeFile(join(root, "src", "app.ts"), "export const value = 1;\n");
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
