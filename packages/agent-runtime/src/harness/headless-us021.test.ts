import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentToolContext, ContentBlock, Message } from "@cline/sdk";
import { previewDevtoolsMcpTools } from "../preview-harness-tools.js";
import { blameSpecialistAgentIds } from "../specialist-agents.js";
import { createConsultSpecialistTool } from "../specialist-consult-tool.js";
import { projectMessages } from "./blame-compaction.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import type { HarnessToolResult, HarnessToolSuccess } from "./protocol.js";
import { RunLifecycleRegistry } from "./run-lifecycle.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import type {
  DependencyExecutorCapability,
  TaskExecutionInput,
  TaskExecutionResult,
  TaskExecutor,
} from "./task-executor.js";

test("US-021 compaction cuts tokens by half and preserves atomic tool units", async () => {
  await withUs021Workspace(async (root) => {
    const request = "Preserve this exact request while completing US-021.";
    const memory = await preparedMemory(root, request);
    const transcript = longTranscript(request);
    const projected = await projectMessages(
      transcript,
      compactionOptions(memory),
    );
    assert.ok(estimatedTokens(projected) < estimatedTokens(transcript) * 0.5);
    assert.equal(JSON.stringify(projected).split(request).length - 1, 1);
    assertToolUnitsAreComplete(projected);
    assert.equal(capsuleText(projected)?.split("workspace-skill").length, 2);
    assert.equal(
      capsuleText(projected)?.split("reliability-reviewer").length,
      2,
    );
    assert.doesNotMatch(capsuleText(projected) ?? "", /obsolete conclusion/u);
    assert.match(capsuleText(projected) ?? "", /atomicity review completed/u);
    const replayed = await projectMessages(
      projected,
      compactionOptions(memory),
      undefined,
      "overflow",
    );
    assert.equal(capsuleText(replayed), capsuleText(projected));
  });
});

test("US-021 workspace state uses a same-revision receipt pointer", async () => {
  await withUs021Workspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const first = success(await workspace.workspaceState()).data;
    const repeated = success(await workspace.workspaceState()).data;
    assert.equal(repeated.status, "already_available");
    assert.equal(repeated.workspace_state_ref, first.workspace_state_ref);
    assert.equal(Object.hasOwn(repeated, "capabilities"), false);
    assert.equal(Object.hasOwn(repeated, "task_catalog"), false);
    assert.equal(
      repeated.source_revision.source_revision_id,
      first.source_revision.source_revision_id,
    );
  });
});

test("US-021 default edit batches never expose partial writes", async () => {
  await withUs021Workspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const result = success(
      await workspace.editFiles({
        operations: atomicFailureOperations(),
      }),
    );
    assert.equal(result.data.status, "validation_failed");
    for (let index = 0; index < 12; index += 1)
      await assert.rejects(readFile(join(root, `src/generated-${index}.ts`)));
  });
});

test("US-021 moves roll back with the rest of an invalid batch", async () => {
  await withUs021Workspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "move_file",
            from_path: "src/original.ts",
            to_path: "src/moved.ts",
          },
          { operation: "create_file", path: "invalid.json", content: "{,}" },
        ],
      }),
    );
    assert.equal(result.data.status, "validation_failed");
    assert.equal(
      await readFile(join(root, "src/original.ts"), "utf8"),
      "export {}\n",
    );
    await assert.rejects(readFile(join(root, "src/moved.ts")));
  });
});

test("US-021 edits and moves Prisma text when validation is unsupported", async () => {
  await withUs021Workspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "replace_file",
            path: "prisma/schema.prisma",
            content: "model User { id Int @id name String }\n",
          },
          {
            operation: "move_file",
            from_path: "prisma/schema.prisma",
            to_path: "database/schema.prisma",
          },
        ],
      }),
    );
    assert.equal(result.data.status, "applied");
    assert.equal(result.data.validation.status, "unsupported");
    assert.match(
      await readFile(join(root, "database/schema.prisma"), "utf8"),
      /name String/u,
    );
    await assert.rejects(readFile(join(root, "prisma/schema.prisma")));
  });
});

test("US-021 mutates dependencies without losing unchanged read coverage", async () => {
  await withUs021Workspace(async (root) => {
    const executor = new Us021PnpmExecutor();
    const workspace = new SemanticWorkspace(root, { taskExecutor: executor });
    const firstRead = success(
      await workspace.inspectCode(
        { target: { path: "src/original.ts" }, view: "raw" },
        undefined,
        { contextEpoch: "before-dependency" },
      ),
    );
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    const mutation = success(
      await workspace.mutateDependencies({
        source_revision_id: revision,
        package_path: "package.json",
        operations: [
          {
            action: "add",
            dependency_type: "dependencies",
            name: "kleur",
            version: "^4.1.5",
          },
        ],
        timeout_ms: 30_000,
      }),
    );
    const repeatedRead = success(
      await workspace.inspectCode(
        { target: { path: "src/original.ts" }, view: "raw" },
        undefined,
        { contextEpoch: "after-dependency" },
      ),
    );
    assert.equal(mutation.outcome, "applied");
    assert.equal(executor.executions, 1);
    assert.equal(firstRead.outcome, "completed");
    assert.equal(repeatedRead.outcome, "skipped");
  });
});

test("US-021 cancels and deduplicates long specialist consultations", async () => {
  let executions = 0;
  let cancelled = false;
  const tool = createConsultSpecialistTool({
    objective: "Complete US-021",
    timeoutMs: 10,
    spawnTool: {
      execute: async (_input: unknown, context: AgentToolContext) => {
        executions += 1;
        if (executions > 1) return { output: "useful conclusion" };
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
  const input = {
    specialist: blameSpecialistAgentIds[0],
    task: "Review the atomic Prisma migration.",
  };
  const first = await tool.execute(input, toolContext("src_us021"));
  const retry = await tool.execute(input, toolContext("src_us021"));
  const repeated = await tool.execute(input, toolContext("src_us021"));
  assert.equal(record(first).reason, "SPECIALIST_TIMEOUT");
  assert.equal(record(retry).outcome, "completed");
  assert.equal(record(repeated).outcome, "skipped");
  assert.equal(cancelled, true);
  assert.equal(executions, 2);
});

test("US-021 retries transient DevTools once with current revision evidence", async () => {
  await withUs021Workspace(async (root) => {
    let calls = 0;
    const tools = await previewDevtoolsMcpTools(
      {
        previewDevtools: async () => previewTarget(),
        previewDevtoolsCall: async () => {
          calls += 1;
          if (calls === 1) throw new Error("Target closed");
          return { content: [{ type: "text", text: "snapshot" }] };
        },
        previewDevtoolsTools: async () => [
          {
            name: "take_snapshot",
            description: "Take a snapshot",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
      { scope: "us021", worktree: root },
      { log() {} },
    );
    const snapshot = await tools[0]!.execute({}, toolContext("src_us021"));
    assert.equal(calls, 2);
    assert.equal(
      record(record(snapshot)._meta).previewReadyEvidence !== undefined,
      true,
    );
  });
});

test("US-021 returns a non-terminal receipt without retrying a DevTools timeout", async () => {
  await withUs021Workspace(async (root) => {
    let calls = 0;
    const tools = await previewDevtoolsMcpTools(
      {
        previewDevtools: async () => previewTarget(),
        previewDevtoolsCall: async () => {
          calls += 1;
          throw new Error("MCP error -32001: Request timed out");
        },
        previewDevtoolsTools: async () => [
          {
            name: "take_screenshot",
            inputSchema: { type: "object", properties: {} },
          },
        ],
      },
      { scope: "us021", worktree: root },
      { log() {} },
    );
    const result = record(
      await tools[0]!.execute({}, toolContext("src_us021")),
    );
    assert.equal(calls, 1);
    assert.equal(result.isError, false);
    assert.equal(result.outcome, "unavailable");
    assert.equal(result.reason, "PREVIEW_DEVTOOLS_TRANSIENT_FAILURE");
  });
});

test("US-021 lifecycle has one cancelling path and one terminal transition", () => {
  const runs = new RunLifecycleRegistry();
  assert.equal(runs.begin("session", "execution").state, "running");
  assert.equal(runs.stopping("session", "execution"), true);
  assert.equal(runs.state("session")?.state, "cancelling");
  assert.equal(runs.canInvoke("session", "execution"), false);
  assert.equal(runs.finish("session", "execution", "cancelled"), true);
  assert.equal(runs.finish("session", "execution", "failed"), false);
  assert.equal(runs.state("session")?.state, "cancelled");
});

test("US-021 cancellation reaches an in-flight operation before terminal", async () => {
  const runs = new RunLifecycleRegistry();
  const controller = new AbortController();
  let cancellationCount = 0;
  runs.begin("session", "in-flight");
  const operation = new Promise<string>((resolve) => {
    controller.signal.addEventListener(
      "abort",
      () => {
        cancellationCount += 1;
        resolve("cancelled");
      },
      { once: true },
    );
  });
  assert.equal(runs.stopping("session", "in-flight"), true);
  controller.abort();
  assert.equal(await operation, "cancelled");
  assert.equal(runs.finish("session", "in-flight", "cancelled"), true);
  assert.equal(runs.canInvoke("session", "in-flight"), false);
  assert.equal(cancellationCount, 1);
  assert.equal(runs.state("session")?.post_stop_events, 0);
  assert.equal(runs.state("session")?.post_stop_tokens, 0);
});

async function preparedMemory(root: string, request: string) {
  const memory = new ConversationMemoryStore(root, "us-021");
  await memory.beginRequest({ currentRequest: request, userGoal: request });
  await memory.recordChange({
    files: ["src/original.ts"],
    receiptId: "changeset://us-021",
    sourceRevisionId: "src_us021",
    summary: "Prepared US-021 state",
    symbols: [],
    validation: "pending",
  });
  await memory.recordKnowledge([
    "Loaded skill: workspace-skill",
    "Loaded skill: workspace-skill",
    "Specialist consultation: reliability-reviewer; conclusion=obsolete conclusion",
    "Specialist consultation: reliability-reviewer; conclusion=atomicity review completed",
  ]);
  return memory;
}

function compactionOptions(memory: ConversationMemoryStore) {
  return {
    memory,
    model: { id: "us-021", contextWindow: 24_000, maxTokens: 4_000 },
    systemPrompt: "System policy",
    tools: [{ name: "inspect_code", inputSchema: { type: "object" } }],
  };
}

function longTranscript(request: string): Message[] {
  return [
    requestMessage(request),
    ...Array.from({ length: 18 }, toolUnit).flat(),
  ];
}

function requestMessage(request: string): Message {
  return {
    id: "request",
    role: "user",
    content: [{ type: "text", text: request }],
    createdAt: 0,
  };
}

function toolUnit(index: number): Message[] {
  const id = `tool-${index}`;
  return [
    message("assistant", index * 3 + 1, [
      { type: "text", text: "Reasoning ".repeat(300) },
      { type: "tool_use", id, name: "inspect_code", input: { index } },
    ]),
    message("user", index * 3 + 2, [
      { type: "tool_result", tool_use_id: id, content: "result ".repeat(300) },
    ]),
    message("assistant", index * 3 + 3, [
      { type: "text", text: `Closed ${id}.` },
    ]),
  ];
}

function message(
  role: Message["role"],
  createdAt: number,
  content: Message["content"],
): Message {
  return { id: `message-${createdAt}`, role, content, createdAt };
}

function assertToolUnitsAreComplete(messages: Message[]) {
  const uses = new Set(messages.flatMap(toolUseIds));
  const results = new Set(messages.flatMap(toolResultIds));
  assert.deepEqual([...uses].sort(), [...results].sort());
}

function toolUseIds(messageValue: Message) {
  return blocks(messageValue).flatMap((part) =>
    part.type === "tool_use" ? [part.id] : [],
  );
}

function toolResultIds(messageValue: Message) {
  return blocks(messageValue).flatMap((part) =>
    part.type === "tool_result" ? [part.tool_use_id] : [],
  );
}

function blocks(messageValue: Message): ContentBlock[] {
  return typeof messageValue.content === "string"
    ? [{ type: "text" as const, text: messageValue.content }]
    : messageValue.content;
}

function capsuleText(messages: Message[]) {
  return JSON.stringify(messages).match(
    /<blame_deterministic_capsule>[\s\S]*?<\/blame_deterministic_capsule>/u,
  )?.[0];
}

function estimatedTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

function atomicFailureOperations() {
  return [
    ...Array.from({ length: 12 }, (_, index) => ({
      operation: "create_file" as const,
      path: `src/generated-${index}.ts`,
      content: `export const generated${index} = ${index};\n`,
    })),
    { operation: "create_file" as const, path: "invalid.json", content: "{,}" },
  ];
}

async function withUs021Workspace(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-us021-"));
  try {
    await mkdir(join(root, "prisma"), { recursive: true });
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      '{"name":"us021","packageManager":"pnpm@10.32.1","scripts":{}}\n',
    );
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(
      join(root, "prisma/schema.prisma"),
      "model User { id Int @id }\n",
    );
    await writeFile(join(root, "src/original.ts"), "export {}\n");
    await operation(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function success<T>(result: HarnessToolResult<T>): HarnessToolSuccess<T> {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

function toolContext(sourceRevisionId: string) {
  return {
    agentId: "us021",
    iteration: 1,
    metadata: { sourceRevisionId },
  } as AgentToolContext;
}

function previewTarget() {
  return {
    available: true,
    browserUrl: "http://127.0.0.1:9222",
    loading: false,
    mcpServer: { args: [], command: "node", name: "devtools" },
    message: "Ready",
    reason: "PREVIEW_BROWSER_READY",
    status: "ready" as const,
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

class Us021PnpmExecutor implements TaskExecutor {
  executions = 0;

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
    this.executions += 1;
    await mkdir(join(input.overlayRoot, "node_modules/.pnpm"), {
      recursive: true,
    });
    await writeFile(
      join(input.overlayRoot, "pnpm-lock.yaml"),
      "lockfile-generated-by-us021\n",
    );
    return {
      exitCode: 0,
      isolation: "worktree",
      outputTruncated: false,
      packageManagerResolution: {
        name: "pnpm",
        requestedVersion: "10.32.1",
        resolvedVersion: "10.32.1",
        strategy: "exact",
      },
      signal: null,
      status: "passed",
      stderr: "",
      stdout: "",
    };
  }
}
