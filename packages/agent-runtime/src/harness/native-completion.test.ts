import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentRuntime, type AgentEvent } from "@cline/sdk";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { environmentSpec } from "./environment-service.js";
import {
  createNativeCompletionTool,
  nativeCompletionToolName,
  type NativeCompletionNotification,
  type NativeValidationActivity,
} from "./native-completion.js";
import { harnessError, harnessSuccess } from "./protocol.js";
import type { SemanticWorkspaceExecutor } from "./semantic-executor.js";
import { WorkspaceFiles } from "./workspace-files.js";

test("the installed Cline SDK exposes exactly the native terminal contract", async () => {
  await withCompletion(
    async ({ root, tool }) => {
      assert.equal(tool.name, nativeCompletionToolName);
      assert.equal(tool.lifecycle?.completesRun, true);
      assert.deepEqual(
        Object.keys(
          (tool.inputSchema as { properties: Record<string, unknown> })
            .properties,
        ).sort(),
        ["summary", "verified"],
      );
      const result = await tool.execute(
        { summary: "Natural final response", verified: true },
        toolContext(),
      );
      assert.equal(result, "Natural final response");
      const memory = new ConversationMemoryStore(root, "session");
      assert.equal(
        (await memory.snapshot()).recentDialogue.at(-1)?.content,
        "Natural final response",
      );
    },
    { taskContract: { effect_requirement: "none" } },
  );
});

test("completion persistence settles before notification and terminal return", async () => {
  let persistedBeforeNotification = false;
  await withCompletion(
    async ({ tool }) => {
      const result = await tool.execute(
        { summary: "Persisted response", verified: true },
        toolContext(),
      );
      assert.equal(result, "Persisted response");
      assert.equal(persistedBeforeNotification, true);
    },
    {
      taskContract: { effect_requirement: "none" },
      onComplete: async (_notification, memory) => {
        const snapshot = await memory.snapshot();
        persistedBeforeNotification =
          snapshot.recentDialogue.at(-1)?.content === "Persisted response";
      },
    },
  );
});

test("Cline recognizes native submit_and_exit and preserves event order", async () => {
  await withCompletion(
    async ({ tool }) => {
      const eventTypes: string[] = [];
      const runtime = createAgentRuntime({
        agentId: "contract-agent",
        completionPolicy: { requireCompletionTool: true },
        maxIterations: 3,
        model: {
          async *stream() {
            yield { type: "text-delta", text: "Working first." } as const;
            yield {
              type: "tool-call-delta",
              toolCallId: "native-submit",
              toolName: "submit_and_exit",
              input: { summary: "Finished naturally.", verified: false },
            } as const;
            yield { type: "finish", reason: "tool-calls" } as const;
          },
        },
        systemPrompt: "Use the terminal tool.",
        tools: [tool],
      });
      runtime.subscribe((event: AgentEvent) => eventTypes.push(event.type));
      const result = await runtime.run("Implement the request.");
      assert.equal(result.status, "completed");
      assert.equal(result.outputText, "Finished naturally.");
      const messages = result.messages as Array<{
        content: Array<{ type: string }>;
        role: string;
      }>;
      const assistantMessage = messages.find(
        ({ role }) => role === "assistant",
      );
      assert.deepEqual(
        assistantMessage?.content.map(({ type }) => type),
        ["text", "tool-call"],
      );
      assert.equal(
        messages.find(({ role }) => role === "tool")?.content[0]?.type,
        "tool-result",
      );
      assert.ok(
        eventTypes.indexOf("assistant-text-delta") <
          eventTypes.indexOf("tool-started"),
      );
      assert.ok(
        eventTypes.indexOf("tool-finished") <
          eventTypes.indexOf("run-finished"),
      );
    },
    { taskContract: { effect_requirement: "none" } },
  );
});

test("Cline reports an incomplete run when the budget ends without submit_and_exit", async () => {
  await withCompletion(async ({ tool }) => {
    const runtime = createAgentRuntime({
      agentId: "budget-contract-agent",
      completionPolicy: { requireCompletionTool: true },
      maxIterations: 2,
      model: {
        async *stream() {
          yield {
            type: "text-delta",
            text: '{"status":"blocked","completionAllowed":false}',
          } as const;
          yield { type: "finish", reason: "stop" } as const;
        },
      },
      systemPrompt: "Use the terminal tool.",
      tools: [tool],
    });
    const result = await runtime.run("Implement the request.");
    assert.ok(["failed", "max_iterations"].includes(result.status));
    assert.equal(result.iterations, 2);
  });
});

test("a mutating task contract cannot complete without an effect", async () => {
  const notifications: NativeCompletionNotification[] = [];
  await withCompletion(
    async ({ tool }) => {
      await assert.rejects(
        tool.execute(
          { summary: "No files changed.", verified: true },
          toolContext(),
        ),
        /delivery is unsatisfied/iu,
      );
      assert.deepEqual(notifications, []);
    },
    {
      notifications,
      taskContract: { effect_requirement: "source_change" },
    },
  );
});

test("automatic validation runs the minimum proof plan and ignores model claims", async () => {
  const calls: unknown[] = [];
  const notifications: NativeCompletionNotification[] = [];
  const validationActivities: NativeValidationActivity[] = [];
  await withCompletion(
    async ({ memory, root, tool }) => {
      await recordPendingChange(memory, root);
      const result = await tool.execute(
        { summary: "Implemented.", verified: false },
        toolContext(),
      );
      assert.equal(result, "Implemented.");
      assert.equal(calls.length, 2);
      assert.equal(notifications[0]?.summary, "Implemented.");
      assert.equal(notifications[0]?.verified, true);
      assert.equal(notifications[0]?.submission_outcome, "accepted");
      assert.equal(notifications[0]?.completion.delivery, "satisfied");
      assert.equal(notifications[0]?.completion.verification, "verified");
      assert.deepEqual(
        validationActivities.map(({ phase }) => phase),
        ["started", "finished", "started", "finished"],
      );
      assert.equal(validationActivities[0]?.request.tool, "run_task");
      assert.equal(validationActivities[1]?.output, passedRunResult);
      assert.equal(validationActivities[3]?.output, passedRunResult);
    },
    {
      executor: async (request) => {
        calls.push(request);
        return passedRunResult;
      },
      notifications,
      validationActivities,
    },
  );
});

test("the evidence plan executes every selected declared check", async () => {
  const requests: unknown[] = [];
  await withCompletion(
    async ({ memory, root, tool }) => {
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          scripts: {
            build: "tsc --build",
            test: "node --test",
            typecheck: "tsc --noEmit",
          },
        }),
      );
      await recordPendingChange(memory, root);
      await tool.execute(
        { summary: "Implemented.", verified: true },
        toolContext(),
      );
      assert.deepEqual(
        requests.map((request) =>
          nestedString(request, "input", "task", "task_id"),
        ),
        ["typecheck", "test"],
      );
    },
    {
      executor: async (request) => {
        requests.push(request);
        return passedRun();
      },
    },
  );
});

test("failed validation cannot be converted into a successful second submission", async () => {
  let calls = 0;
  await withCompletion(
    async ({ tool }) => {
      await assert.rejects(
        tool.execute(
          { summary: "First submission", verified: true },
          toolContext(),
        ),
        /repairable code error/iu,
      );
      await assert.rejects(
        tool.execute(
          { summary: "Second submission", verified: true },
          toolContext(),
        ),
        /required verification failed/iu,
      );
      assert.equal(calls, 1);
    },
    {
      beforeTool: recordPendingChange,
      executor: async () => {
        calls += 1;
        return failedRun();
      },
    },
  );
});

test("a corrected revision receives one new validation and then completes", async () => {
  let calls = 0;
  const notifications: NativeCompletionNotification[] = [];
  await withCompletion(
    async ({ memory, root, tool }) => {
      await assert.rejects(
        tool.execute(
          { summary: "First submission", verified: true },
          toolContext(),
        ),
        /repairable code error/iu,
      );
      await writeFile(
        join(root, "src/example.ts"),
        "export const example = 2;\n",
      );
      await recordPendingChange(memory, root);
      const result = await tool.execute(
        { summary: "Corrected and complete.", verified: false },
        toolContext(),
      );
      assert.equal(result, "Corrected and complete.");
      assert.equal(calls, 3);
      assert.equal(notifications.at(-1)?.verified, true);
      assert.equal(notifications.at(-1)?.submission_outcome, "accepted");
      assert.equal(notifications.at(-1)?.completion.verification, "verified");
    },
    {
      beforeTool: recordPendingChange,
      executor: async () => {
        calls += 1;
        return calls === 1 ? failedRun() : passedRun();
      },
      notifications,
    },
  );
});

test("unrepairable infrastructure validation blocks terminal completion", async () => {
  const notifications: NativeCompletionNotification[] = [];
  await withCompletion(
    async ({ tool }) => {
      const result = await tool.execute(
        { summary: "Implemented.", verified: true },
        toolContext(),
      );
      assert.match(String(result), /Soumission bloquée par le runtime/);
      assert.equal(notifications[0]?.verified, false);
      assert.equal(notifications[0]?.submission_outcome, "blocked");
    },
    {
      beforeTool: recordPendingChange,
      executor: async () =>
        harnessError({
          code: "EXECUTION_ERROR",
          message: "executor unavailable",
        }),
      notifications,
    },
  );
});

test("an interrupted validation does not publish a terminal response", async () => {
  const notifications: NativeCompletionNotification[] = [];
  await withCompletion(
    async ({ tool }) => {
      const controller = new AbortController();
      controller.abort();
      await assert.rejects(
        tool.execute(
          { summary: "Must not be published.", verified: true },
          { ...toolContext(), signal: controller.signal },
        ),
        /abort/iu,
      );
      assert.deepEqual(notifications, []);
    },
    {
      beforeTool: recordPendingChange,
      executor: async () => passedRun(),
      notifications,
    },
  );
});

test("a persisted successful validation is reused after reconnection", async () => {
  let calls = 0;
  await withCompletion(async ({ memory, root }) => {
    await recordPendingChange(memory, root);
    const files = new WorkspaceFiles(root);
    const snapshot = await files.snapshot();
    const sourceRevisionId = snapshot.revision.source_revision_id;
    const environmentRevisionId = (await environmentSpec(files, snapshot))
      .environment_revision_id;
    await memory.recordValidation({
      environmentRevisionId,
      id: "run://passed",
      sourceRevisionId,
      status: "passed",
      taskId: "test",
      taskKind: "test",
      terminal: "passed",
    });
    await memory.recordValidation({
      environmentRevisionId,
      id: "run://typecheck-passed",
      sourceRevisionId,
      status: "passed",
      taskId: "typecheck",
      taskKind: "typecheck",
      terminal: "passed",
    });
    const reconnectedTool = createNativeCompletionTool({
      conversationId: "session",
      executor: async () => {
        calls += 1;
        return passedRun();
      },
      workspaceRoot: root,
    });
    const result = await reconnectedTool.execute(
      { summary: "Resumed and complete.", verified: false },
      toolContext(),
    );
    assert.equal(result, "Resumed and complete.");
    assert.equal(calls, 0);
  });
});

type CompletionFixture = {
  memory: ConversationMemoryStore;
  root: string;
  tool: ReturnType<typeof createNativeCompletionTool>;
};

async function withCompletion(
  operation: (fixture: CompletionFixture) => Promise<void>,
  options: {
    beforeTool?(
      memory: ConversationMemoryStore,
      root: string,
    ): Promise<unknown>;
    executor?: SemanticWorkspaceExecutor;
    notifications?: NativeCompletionNotification[];
    onComplete?(
      notification: NativeCompletionNotification,
      memory: ConversationMemoryStore,
    ): Promise<void> | void;
    taskContract?: {
      effect_requirement?: "none" | "source_change";
    };
    validationActivities?: NativeValidationActivity[];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "blame-native-completion-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "node --test", typecheck: "tsc --noEmit" },
      }),
    );
    await mkdir(join(root, "src"));
    await writeFile(
      join(root, "src/example.ts"),
      "export const example = 1;\n",
    );
    const memory = new ConversationMemoryStore(root, "session");
    await memory.beginRequest({
      currentRequest: "Implement it.",
      userGoal: "Goal",
    });
    await options.beforeTool?.(memory, root);
    const tool = createNativeCompletionTool({
      conversationId: "session",
      executor: options.executor ?? (async () => passedRun()),
      onComplete: async (notification) => {
        await options.onComplete?.(notification, memory);
        options.notifications?.push(notification);
      },
      onValidationActivity: (activity) => {
        options.validationActivities?.push(activity);
      },
      taskContract: options.taskContract,
      workspaceRoot: root,
    });
    await operation({ memory, root, tool });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function recordPendingChange(
  memory: ConversationMemoryStore,
  root: string,
) {
  const sourceRevisionId = (await new WorkspaceFiles(root).snapshot()).revision
    .source_revision_id;
  return memory.recordChange({
    receiptId: `changeset://${sourceRevisionId}`,
    sourceRevisionId,
    files: ["src/example.ts"],
    symbols: ["example"],
    summary: "Updated example",
    validation: "not_run",
  });
}

function passedRun() {
  return harnessSuccess({
    data: { status: "passed" },
    revision: {},
    startedAt: Date.now(),
    provenance: [],
  });
}

const passedRunResult = passedRun();

function failedRun() {
  return harnessSuccess({
    data: { status: "failed", failures: [{ message: "Type mismatch" }] },
    revision: {},
    startedAt: Date.now(),
    provenance: [],
  });
}

function toolContext() {
  return {
    agentId: "agent",
    conversationId: "conversation",
    iteration: 1,
    runId: "run",
    sessionId: "session",
    toolCallId: "submit",
  };
}

function nestedString(value: unknown, ...path: string[]) {
  let selected = value;
  for (const key of path) {
    if (!selected || typeof selected !== "object") return undefined;
    selected = (selected as Record<string, unknown>)[key];
  }
  return typeof selected === "string" ? selected : undefined;
}
