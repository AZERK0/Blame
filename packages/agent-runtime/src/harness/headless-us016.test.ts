import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { execa } from "execa";
import { usageSnapshot } from "../agent-telemetry.js";
import { BlameAgentRuntime } from "../cline-runtime.js";
import type { AgentEvent } from "../types.js";
import { semanticWorkspaceTools } from "./cline-tools.js";
import { maximumSemanticParseBytes } from "./code-navigation-policy.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import {
  dependencyCacheRoot,
  writeDependencyCacheManifest,
} from "./dependency-cache.js";
import { ExternalReadGovernor } from "./external-read-governor.js";
import { harnessSuccess, type HarnessToolResult } from "./protocol.js";
import type { TaskCatalogItem } from "./schemas.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import { readTaskCatalog } from "./task-catalog.js";
import type {
  DependencyExecutorCapability,
  TaskExecutionResult,
  TaskExecutor,
} from "./task-executor.js";

const liveHeadlessEnabled = process.env.BLAME_HEADLESS_US016 === "true";

test(
  "GPT-5.6 Sol X-high completes US-016 without capability or navigation cascades",
  { skip: !liveHeadlessEnabled, timeout: 3_600_000 },
  async () => {
    const configuration = liveHeadlessConfiguration();
    assert.match(configuration.modelId, /gpt-?5\.6.*sol/iu);
    for (let index = 0; index < 3; index += 1)
      await runLiveHeadlessUs016(configuration, index);
  },
);

test("US-016 exposes an unavailable dependency executor before any mutation", async () => {
  await withUs016Workspace(async (root) => {
    const executor = new UnavailableDependencyExecutor();
    const workspace = new SemanticWorkspace(root, {
      taskContract: {
        session_id: "us016-capability",
        objective: "Add a project carousel without installing a package",
      },
      taskExecutor: executor,
    });
    const state = success(await workspace.workspaceState());
    const projection = recordValue(state.data.task_projection);
    const dependencyInventory = recordValue(projection.dependency_inventory);
    const mutation = recordValue(dependencyInventory.mutation);
    assert.equal(mutation.available, false);
    assert.equal(
      mutation.reason,
      "DEPENDENCY_NETWORK_UNAVAILABLE:allowlist proxy unavailable",
    );
    assert.equal(
      state.data.task_catalog.some(({ kind }) => kind === "dependencies"),
      false,
    );
    assert.equal(
      recordArray(projection.relevant_targets).some(
        (target) => target.path === "src/projects-carousel.tsx",
      ),
      true,
    );
    const revision = state.data.source_revision.source_revision_id;
    const mutationResult = success(
      await workspace.mutateDependencies({
        source_revision_id: revision,
        package_path: "package.json",
        operations: [
          {
            action: "add",
            name: "embla-carousel-react",
            version: "^8.0.0",
            dependency_type: "dependencies",
          },
        ],
        timeout_ms: 30_000,
      }),
    );
    assert.equal(mutationResult.outcome, "unavailable");
    assert.deepEqual(Object.keys(recordValue(mutationResult.data)).sort(), [
      "dependencies_already_available",
      "reason",
      "retryable",
      "strategies",
      "unavailable_code",
    ]);
    assert.equal(
      recordValue(mutationResult.data).unavailable_code,
      "DEPENDENCY_NETWORK_UNAVAILABLE",
    );
    assert.equal(recordValue(mutationResult.data).retryable, false);
    assert.deepEqual(recordValue(mutationResult.data).strategies, [
      "reuse_existing_dependency",
      "implement_without_dependency",
      "report_blocked",
    ]);
    const dependencyRun = await workspace.runTask({
      source_revision_id: revision,
      task: { kind: "dependencies" },
      limits: { timeout_ms: 30_000 },
    });
    assert.equal(dependencyRun.status, "success");
    if (dependencyRun.status === "success") {
      assertUnavailableReceipt(dependencyRun.data);
      assert.equal(recordValue(dependencyRun.data).circuit_opened, false);
    }
    assert.equal(executor.executions, 0);
  });
});

test("US-016 workspace state is exhaustive for architecture and honors explicit sections", async () => {
  await withUs016Workspace(async (root) => {
    const tools = semanticWorkspaceTools(root, {
      taskContract: {
        session_id: "us016-state-budget",
        objective: "Add database driven interactive project carousel backend",
      },
    });
    const workspaceState = requiredTool(tools, "workspace_state");
    const complete = await workspaceState.execute({}, toolContext("state"));
    assert.ok(Buffer.byteLength(JSON.stringify(complete)) <= 32_000);
    assert.ok(
      Number(recordValue(recordValue(complete).usage).output_tokens) <= 8_000,
    );
    assert.ok(resultData(complete).task_projection);
    const selected = await workspaceState.execute(
      { include: ["source_revision"] },
      toolContext("state-source"),
    );
    assert.deepEqual(Object.keys(resultData(selected)), ["source_revision"]);
    assert.ok(Buffer.byteLength(JSON.stringify(selected)) <= 32_000);
  });
});

test("US-016 task projection ignores generic migration vocabulary", async () => {
  await withUs016Workspace(async (root) => {
    await mkdir(join(root, "prisma", "migrations"), { recursive: true });
    for (let index = 0; index < 16; index += 1)
      await writeFile(
        join(root, "prisma", "migrations", `${index}-project-database.sql`),
        "CREATE TABLE project_api (id TEXT);\n",
      );
    const workspace = new SemanticWorkspace(root, {
      taskContract: {
        session_id: "us016-ranking",
        objective: "Add database driven interactive project carousel backend",
      },
    });
    const state = success(await workspace.workspaceState());
    const projection = recordValue(state.data.task_projection);
    const paths = recordArray(projection.relevant_targets)
      .map((target) => stringValue(target.path))
      .filter((path): path is string => Boolean(path));
    assert.equal(paths[0], "src/projects-carousel.tsx");
    assert.equal(
      paths.some((path) => path.includes("migrations")),
      false,
    );
  });
});

test("US-016 persists the dependency circuit across workspace instances", async () => {
  await withUs016Workspace(async (root) => {
    const firstExecutor = new UnavailableDependencyExecutor();
    const first = workspaceForCircuit(root, firstExecutor);
    const revision = success(await first.workspaceState()).data.source_revision
      .source_revision_id;
    success(
      await first.mutateDependencies({
        source_revision_id: revision,
        package_path: "package.json",
        operations: [
          {
            action: "add",
            name: "embla-carousel-react",
            version: "^8.0.0",
            dependency_type: "dependencies",
          },
        ],
        timeout_ms: 30_000,
      }),
    );
    const secondExecutor = new UnavailableDependencyExecutor();
    const second = workspaceForCircuit(root, secondExecutor);
    const state = success(await second.workspaceState());
    const mutation = recordValue(
      recordValue(recordValue(state.data.task_projection).dependency_inventory)
        .mutation,
    );
    assert.equal(mutation.circuit_open, true);
    assert.equal(secondExecutor.executions, 0);
  });
});

test("US-016 resets the dependency circuit when a prepared cache appears", async () => {
  await withUs016Workspace(async (root) => {
    const executor = new CacheOnlyDependencyExecutor();
    const first = workspaceForCircuit(root, executor);
    const firstState = success(await first.workspaceState());
    const revision = firstState.data.source_revision.source_revision_id;
    success(await first.mutateDependencies(dependencyMutation(revision)));
    const taskCatalog = await readTaskCatalog(root);
    const cacheRoot = await dependencyCacheRoot(
      root,
      ["package.json", "pnpm-lock.yaml"],
      requiredDependencyTask(taskCatalog),
    );
    await writeDependencyCacheManifest(cacheRoot, {
      schema_version: "1.0",
      dependency_digest: "prepared",
      package_manager: "pnpm",
      resolved_version: "10.32.1",
      platform: process.platform,
      architecture: process.arch,
      runtime_target: "linux-native",
      created_at: new Date().toISOString(),
      integrity_probe: {
        status: "passed",
        cwd: root,
        executables: {},
        packages: {},
        symlink_targets_present: true,
        store_present: true,
        checked_at: new Date().toISOString(),
      },
    });
    const second = workspaceForCircuit(root, executor);
    const mutation = workspaceDependencyMutation(
      success(await second.workspaceState()).data.task_projection,
    );
    assert.equal(mutation.available, true);
    assert.equal(mutation.circuit_open, false);
    assert.equal(executor.executions, 0);
  });
});

test("US-016 keeps broad outlines below two thousand tokens with concrete continuation targets", async () => {
  await withUs016Workspace(async (root) => {
    for (let index = 0; index < 300; index += 1)
      await writeFile(
        join(root, "src", `component-${index}.tsx`),
        `export function Component${index}() { return <div>${index}</div>; }\n`,
      );
    const workspace = new SemanticWorkspace(root, {
      taskContract: {
        session_id: "us016-outline",
        objective: "Change Component299 in the project carousel",
      },
    });
    const result = success(
      await workspace.outlineCode({
        target: { path: "src" },
        budget: { max_items: 300, max_output_tokens: 2_000 },
      }),
    );
    assert.ok(result.usage.output_tokens < 2_000);
    const measured = structuredClone(result);
    measured.usage.output_tokens = 0;
    assert.equal(
      result.usage.output_tokens,
      Math.ceil(Buffer.byteLength(JSON.stringify(measured), "utf8") / 4),
    );
    assert.equal(result.coverage.truncated, true);
    assert.equal(result.data.auto_narrowed, true);
    assert.ok(result.data.continuation_targets.length > 0);
    assert.equal(
      result.data.items.some(
        ({ qualified_name }) => qualified_name === "Component299",
      ),
      true,
    );
  });
});

test("US-016 narrows whole-file ranges and skips semantic parsing above two MiB", async () => {
  await withUs016Workspace(async (root) => {
    const oversizedPath = join(root, "src", "generated.tsx");
    await writeFile(
      oversizedPath,
      `export const generated = "${"x".repeat(maximumSemanticParseBytes)}";`,
    );
    const workspace = new SemanticWorkspace(root);
    const size = maximumSemanticParseBytes + 28;
    const inspection = success(
      await workspace.inspectCode({
        target: { path: "src/generated.tsx" },
        view: "raw",
        range_utf8_bytes: [0, size],
      }),
    );
    assert.equal(inspection.data.status, "auto_narrowed");
    if (inspection.data.status !== "auto_narrowed") return;
    assert.equal(inspection.data.auto_narrow_reason, "semantic_parse_limit");
    assert.deepEqual(inspection.data.requested_range, [0, size]);
    assert.deepEqual(inspection.data.returned_range, [0, 2 * 1024]);
    assert.equal(inspection.data.file_size, size);
    assert.equal(inspection.data.coverage, "partial");
  });
});

test("US-016 single-flight suppresses only identical reads", async () => {
  await withUs016Workspace(async (root) => {
    const calls: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tools = semanticWorkspaceTools(root, {
      executor: async ({ tool }) => {
        calls.push(tool);
        await gate;
        return contentReceipt();
      },
    });
    const relation = requiredTool(tools, "get_relation_context");
    const input = { target: { symbol_ref: "s_01" } };
    const first = relation.execute(input, toolContext("relation-a"));
    await waitFor(() => calls.length === 1);
    const reused = await relation.execute(input, toolContext("relation-b"));
    assert.equal(resultData(reused).status, "in_flight_reused");
    assert.equal(recordValue(reused).isError, undefined);
    release();
    await first;
    const outline = requiredTool(tools, "outline_code");
    await outline.execute({ target: { path: "." } }, toolContext("outline"));
    const search = requiredTool(tools, "search_code");
    const budgetSuppressed = await search.execute(
      { query: { kind: "text", pattern: "Component" } },
      toolContext("search"),
    );
    assert.equal(
      resultData(budgetSuppressed).shared_iteration_budget_suppressed,
      undefined,
    );
    assert.equal(recordValue(budgetSuppressed).isError, undefined);
    assert.deepEqual(calls, [
      "get_relation_context",
      "outline_code",
      "search_code",
    ]);
  });
});

test("US-016 suppresses equivalent node_modules probes after one missing package", () => {
  const governor = governorWithMissingPackage("missing-package");
  const suppressed = governor.before(
    "inspect_code",
    "epoch-1",
    {
      target: { path: "apps/web/node_modules/missing-package/index.js" },
      view: "raw",
    },
    2,
  );
  assert.ok(suppressed);
  assert.equal(suppressed.status, "success");
  if (suppressed.status !== "success") return;
  assert.equal(
    recordValue(suppressed.data).reason,
    "PACKAGE_NOT_DECLARED_OR_INSTALLED",
  );
});

test("US-016 does not confuse package names with source text or paths", () => {
  const governor = governorWithMissingPackage("three");
  const allowed = [
    governor.before(
      "search_code",
      "epoch-1",
      { query: { kind: "text", pattern: "three" } },
      2,
    ),
    governor.before(
      "inspect_code",
      "epoch-1",
      { target: { path: "src/three-dimensional.tsx" }, view: "raw" },
      3,
    ),
    governor.before(
      "outline_code",
      "epoch-1",
      { target: { path: "src/three" } },
      4,
    ),
    governor.before(
      "edit_code",
      "epoch-1",
      { replacement: "import 'node_modules/three/index.js'" },
      5,
    ),
  ];
  assert.deepEqual(allowed, [undefined, undefined, undefined, undefined]);
  const explicit = governor.before(
    "inspect_code",
    "epoch-1",
    { target: { path: "apps/web/node_modules/three/index.js" }, view: "raw" },
    6,
  );
  assert.equal(explicit?.status, "success");
  if (explicit?.status !== "success") return;
  assert.equal(
    recordValue(explicit.data).reason,
    "PACKAGE_NOT_DECLARED_OR_INSTALLED",
  );
});

test("US-016 permits the same read after an applied edit", () => {
  const governor = new HarnessCostGovernor(80, false);
  const input = { query: { kind: "text", pattern: "Carousel" } };
  assert.equal(governor.before("search_code", "epoch-1", input, 1), undefined);
  governor.after("search_code", input, contentReceipt(), { iteration: 1 });
  assert.ok(governor.before("search_code", "epoch-1", input, 2));
  governor.after(
    "edit_code",
    { operations: [] },
    harnessSuccess({
      data: { status: "applied" },
      provenance: [],
      revision: {},
      startedAt: Date.now(),
    }),
    { iteration: 3 },
  );
  assert.equal(governor.before("search_code", "epoch-1", input, 4), undefined);
});

test("US-016 keeps distinct installation research available", async () => {
  const governor = new ExternalReadGovernor();
  const context = {} as never;
  const workspaceState = governor.wrap({
    name: "workspace_state",
    description: "state",
    inputSchema: { type: "object" },
    execute: async () => unavailableWorkspaceState(),
  } as never);
  await workspaceState.execute({}, context);
  const beforeFetch = governor.fetchHooks().beforeTool;
  const afterFetch = governor.fetchHooks().afterTool;
  assert.ok(beforeFetch);
  assert.ok(afterFetch);
  const toolCall = { toolCallId: "suppressed-install-research" };
  const hookSuppressed = await beforeFetch({
    tool: { name: "fetch_web_content" },
    input: { query: "how to install a dependency with pnpm" },
    toolCall,
  } as never);
  assert.equal(hookSuppressed, undefined);
  const hookReceipt = await afterFetch({
    input: { query: "how to install a dependency with pnpm" },
    result: {
      isError: false,
      output: [{ result: "installation documentation", success: true }],
    },
    tool: { name: "fetch_web_content" },
    toolCall,
  } as never);
  assert.equal(Array.isArray(hookReceipt?.result.output), true);
  assert.equal(hookReceipt?.result.isError, false);
  let executions = 0;
  const fetch = governor.wrap({
    name: "fetch_web_content",
    description: "fetch",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return { output: [{ result: "documentation", success: true }] };
    },
  } as never);
  await fetch.execute({ query: "lucide keyboard API" }, context);
  const suppressed = await fetch.execute(
    { query: "how to install a dependency with pnpm" },
    context,
  );
  assert.equal(executions, 1);
  assert.equal(recordValue(suppressed).outcome, "skipped");
});

async function runLiveHeadlessUs016(
  configuration: ReturnType<typeof liveHeadlessConfiguration>,
  index: number,
) {
  await withUs016Workspace(async (root) => {
    await prepareLiveWorkspace(root);
    const events: AgentEvent[] = [];
    let finish: ((event: AgentEvent) => void) | undefined;
    const terminal = new Promise<AgentEvent>((resolve) => {
      finish = resolve;
    });
    const runtime = new BlameAgentRuntime({
      emit(event) {
        events.push(event);
        if (event.type === "done" || event.type === "error") finish?.(event);
      },
    });
    try {
      const session = await runtime.sessions.startDevelopment({
        apiConnection: {
          url: configuration.apiUrl,
          token: configuration.apiToken,
        },
        providerId: configuration.providerId,
        modelId: configuration.modelId,
        credentialLabel: configuration.credentialLabel,
        reasoningEffort: "xhigh",
        title: "US-016 upstream harness fixture",
        summary: liveStoryPrompt,
        cwd: root,
        workspaceRoot: root,
        workspaceMode: "cloud-mirror",
        backend: { mode: "local" },
        executionId: `headless-us016-${index}`,
        storyId: `US-016-headless-${index}`,
        maxIterations: 24,
      });
      const ended = await terminal;
      assert.equal(ended.type, "done", JSON.stringify(ended.payload));
      const messages = await runtime.sessions.messages(session.sessionId);
      assertLiveHeadlessMetrics(messages, events, root);
      assert.equal(await successfulBuildExists(root), true);
    } finally {
      await runtime.sessions.releaseWorkspace(root).catch(() => undefined);
    }
  });

  test("US-016 missing-package evidence never blocks dependency mutation or a new request", () => {
    const governor = governorWithMissingPackage("missing-package");
    assert.equal(
      governor.before(
        "mutate_dependencies",
        "epoch-1",
        { operations: [{ name: "missing-package", operation: "add" }] },
        2,
      ),
      undefined,
    );
    governor.newUserRequest();
    assert.equal(
      governor.before(
        "inspect_code",
        "epoch-2",
        {
          target: { path: "node_modules/missing-package/index.js" },
          view: "raw",
        },
        1,
      ),
      undefined,
    );
  });
}

async function prepareLiveWorkspace(root: string) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  );
  manifest.scripts.build = "node -e \"process.stdout.write('build-ok')\"";
  await writeFile(
    join(root, "package.json"),
    JSON.stringify(manifest, null, 2),
  );
  await writeFile(
    join(root, "src", "projects-carousel.css"),
    ".carousel { display: grid; }\n",
  );
  await execa("git", ["init", "--initial-branch=main"], { cwd: root });
  await execa("git", ["config", "user.email", "headless@blame.test"], {
    cwd: root,
  });
  await execa("git", ["config", "user.name", "Blame Headless"], { cwd: root });
  await execa("git", ["add", "."], { cwd: root });
  await execa("git", ["commit", "-m", "fixture"], { cwd: root });
}

function assertLiveHeadlessMetrics(
  messages: unknown,
  events: AgentEvent[],
  workspaceRoot: string,
) {
  const calls: Array<{ input: unknown; name: string }> = [];
  collectToolCalls(messages, calls, new Set());
  const firstEdit = calls.findIndex(({ name }) => editTools.has(name));
  assert.ok(
    firstEdit >= 0 && firstEdit < 6,
    `first edit call: ${firstEdit + 1}`,
  );
  assert.equal(
    calls.some(({ name }) => name === "mutate_dependencies"),
    false,
  );
  assert.equal(
    calls.some(
      ({ input, name }) =>
        name === "run_task" && JSON.stringify(input).includes("dependencies"),
    ),
    false,
  );
  assertUniqueReadCalls(calls);
  assertWorkspacePaths(calls, workspaceRoot);
  const inputTokens = cumulativeInputTokens(events);
  assert.ok(inputTokens > 0 && inputTokens < 1_740_000, String(inputTokens));
}

function collectToolCalls(
  value: unknown,
  calls: Array<{ input: unknown; name: string }>,
  seenToolCallIds: Set<string>,
) {
  if (Array.isArray(value)) {
    for (const item of value) collectToolCalls(item, calls, seenToolCallIds);
    return;
  }
  const record = recordValue(value);
  if (!Object.keys(record).length) return;
  const namedCall = "input" in record || "arguments" in record;
  const name =
    stringValue(record.toolName) ??
    (namedCall ? stringValue(record.name) : undefined);
  const toolCallId = stringValue(record.toolCallId ?? record.tool_call_id);
  if (name && (!toolCallId || !seenToolCallIds.has(toolCallId))) {
    calls.push({ input: record.input ?? record.arguments ?? {}, name });
    if (toolCallId) seenToolCallIds.add(toolCallId);
  }
  for (const item of Object.values(record))
    collectToolCalls(item, calls, seenToolCallIds);
}

function assertUniqueReadCalls(calls: Array<{ input: unknown; name: string }>) {
  const signatures = new Set<string>();
  for (const call of calls) {
    if (!readTools.has(call.name)) continue;
    const signature = `${call.name}:${JSON.stringify(call.input)}`;
    assert.equal(signatures.has(signature), false, signature);
    signatures.add(signature);
  }
}

function assertWorkspacePaths(
  calls: Array<{ input: unknown; name: string }>,
  workspaceRoot: string,
) {
  const paths: string[] = [];
  for (const { input } of calls) collectPathFields(input, paths);
  for (const path of paths) {
    assert.equal(path.includes("../"), false, path);
    assert.equal(
      path.startsWith("/") && !path.startsWith(workspaceRoot),
      false,
      path,
    );
  }
}

function collectPathFields(value: unknown, paths: string[]) {
  if (Array.isArray(value)) {
    for (const item of value) collectPathFields(item, paths);
    return;
  }
  const record = recordValue(value);
  for (const [key, item] of Object.entries(record)) {
    if (/(?:^|_)path$/u.test(key) && typeof item === "string") paths.push(item);
    else collectPathFields(item, paths);
  }
}

function cumulativeInputTokens(events: AgentEvent[]) {
  return events.reduce(
    (maximum, event) =>
      Math.max(maximum, usageSnapshot(recordValue(event).payload).input),
    0,
  );
}

async function successfulBuildExists(root: string) {
  const directory = join(root, ".blame", "harness", "runs");
  const files = await readdir(directory);
  for (const file of files) {
    const run = JSON.parse(await readFile(join(directory, file), "utf8"));
    if (recordValue(run.task).kind === "build" && run.status === "passed")
      return true;
  }
  return false;
}

function liveHeadlessConfiguration() {
  return {
    apiUrl: requiredEnvironment("BLAME_HEADLESS_API_URL"),
    apiToken: requiredEnvironment("BLAME_HEADLESS_API_TOKEN"),
    providerId: requiredEnvironment("BLAME_HEADLESS_PROVIDER_ID"),
    modelId: requiredEnvironment("BLAME_HEADLESS_MODEL_ID"),
    credentialLabel: process.env.BLAME_HEADLESS_CREDENTIAL_LABEL,
  };
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(`${name} is required for the US-016 headless test.`);
  return value;
}

function workspaceForCircuit(root: string, executor: TaskExecutor) {
  return new SemanticWorkspace(root, {
    taskContract: { session_id: "us016-persistent-circuit" },
    taskExecutor: executor,
  });
}

class UnavailableDependencyExecutor implements TaskExecutor {
  executions = 0;

  capability() {
    return Promise.resolve("worktree" as const);
  }

  dependencyCapability(): Promise<DependencyExecutorCapability> {
    return Promise.resolve({
      available: false,
      network: "cache_only",
      reason: "allowlist proxy unavailable",
    });
  }

  execute(): Promise<TaskExecutionResult> {
    this.executions += 1;
    return Promise.resolve({
      status: "passed",
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      isolation: "worktree",
    });
  }
}

class CacheOnlyDependencyExecutor extends UnavailableDependencyExecutor {
  dependencyCapability(): Promise<DependencyExecutorCapability> {
    return Promise.resolve({ available: true, network: "cache_only" });
  }

  healthCheck() {
    return Promise.resolve({
      available: true as const,
      isolation: "worktree" as const,
    });
  }
}

async function withUs016Workspace(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-us016-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "portfolio-v4",
        packageManager: "pnpm@10.32.1",
        scripts: { build: "next build", typecheck: "tsc --noEmit" },
        dependencies: { "lucide-react": "^1.0.0", next: "^15.0.0" },
      }),
    );
    await writeFile(
      join(root, "pnpm-lock.yaml"),
      "lockfileVersion: '9.0'\npackages:\n  lucide-react@1.0.0: {}\n  next@15.0.0: {}\n",
    );
    await writeFile(
      join(root, "src", "projects-carousel.tsx"),
      "export function ProjectsCarousel() { return <section />; }\n",
    );
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function assertUnavailableReceipt(value: unknown) {
  const receipt = recordValue(value);
  assert.equal(receipt.status, "unavailable");
  assert.equal(receipt.applied, false);
  assert.equal(receipt.retryable, false);
  assert.equal(receipt.capability, "dependency_mutation");
  assert.deepEqual(receipt.alternatives, [
    "reuse_existing_dependency",
    "implement_without_dependency",
    "report_blocked",
  ]);
}

function dependencyMutation(sourceRevisionId: string) {
  return {
    source_revision_id: sourceRevisionId,
    package_path: "package.json",
    operations: [
      {
        action: "add" as const,
        name: "embla-carousel-react",
        version: "^8.0.0",
        dependency_type: "dependencies" as const,
      },
    ],
    timeout_ms: 30_000,
  };
}

function requiredDependencyTask(value: unknown): TaskCatalogItem {
  const task = Array.isArray(value)
    ? value.find((candidate) => recordValue(candidate).kind === "dependencies")
    : undefined;
  assert.ok(task);
  return task as TaskCatalogItem;
}

function workspaceDependencyMutation(value: unknown) {
  return recordValue(
    recordValue(recordValue(value).dependency_inventory).mutation,
  );
}

function contentReceipt() {
  return harnessSuccess({
    data: { status: "content" },
    provenance: [],
    revision: {},
    startedAt: Date.now(),
  });
}

function governorWithMissingPackage(dependency: string) {
  const governor = new HarnessCostGovernor(80, false);
  governor.after(
    "run_task",
    { task: { task_id: "build" } },
    harnessSuccess({
      startedAt: Date.now(),
      revision: {},
      provenance: [],
      data: {
        status: "failed",
        diagnostics: [{ code: "DEPENDENCY_MISSING", dependency }],
      },
    }),
    { iteration: 1 },
  );
  return governor;
}

function unavailableWorkspaceState() {
  return {
    status: "success",
    data: {
      task_projection: {
        dependency_inventory: {
          mutation: {
            capability: "dependency_mutation",
            status: "unavailable",
          },
        },
      },
    },
  };
}

function success<T>(result: HarnessToolResult<T>) {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

function requiredTool(
  tools: ReturnType<typeof semanticWorkspaceTools>,
  name: string,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool);
  return tool;
}

function resultData(value: unknown) {
  return recordValue(recordValue(value).data);
}

function recordArray(value: unknown) {
  return Array.isArray(value) ? value.map(recordValue) : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toolContext(toolCallId: string) {
  return { agentId: "test", iteration: 1, toolCallId };
}

async function waitFor(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Timed out waiting for the single-flight reservation.");
}

const editTools = new Set([
  "create_file",
  "edit_code",
  "edit_files",
  "edit_json",
  "edit_symbol",
  "patch_file",
  "replace_file",
]);

const readTools = new Set([
  "get_relation_context",
  "inspect_code",
  "outline_code",
  "search_code",
]);

const liveStoryPrompt = [
  "Implement an accessible interactive project carousel backed by project data.",
  "Follow the repository conventions and the capabilities reported by workspace_state.",
  "Validate the completed change with the relevant declared task and finish through submit_and_exit.",
].join(" ");
