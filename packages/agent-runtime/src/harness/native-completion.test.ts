import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createAgentRuntime, type AgentEvent } from "@cline/sdk";
import { ConversationMemoryStore } from "./conversation-memory.js";
import {
  createNativeCompletionTool,
  nativeCompletionToolName,
  type NativeCompletionNotification,
  type NativeValidationActivity,
} from "./native-completion.js";
import { harnessError, harnessSuccess } from "./protocol.js";
import type { SemanticWorkspaceExecutor } from "./semantic-executor.js";

test("the installed Cline SDK exposes exactly the native terminal contract", async () => {
  await withCompletion(async ({ root, tool }) => {
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
  });
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
      onComplete: async (_notification, memory) => {
        const snapshot = await memory.snapshot();
        persistedBeforeNotification =
          snapshot.recentDialogue.at(-1)?.content === "Persisted response";
      },
    },
  );
});

test("Cline recognizes native submit_and_exit and preserves event order", async () => {
  await withCompletion(async ({ tool }) => {
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
    const assistantMessage = messages.find(({ role }) => role === "assistant");
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
      eventTypes.indexOf("tool-finished") < eventTypes.indexOf("run-finished"),
    );
  });
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

test("automatic validation runs once and model verified is not trusted", async () => {
  const calls: unknown[] = [];
  const notifications: NativeCompletionNotification[] = [];
  const validationActivities: NativeValidationActivity[] = [];
  await withCompletion(
    async ({ memory, tool }) => {
      await recordPendingChange(memory);
      const result = await tool.execute(
        { summary: "Implemented.", verified: false },
        toolContext(),
      );
      assert.equal(result, "Implemented.");
      assert.equal(calls.length, 1);
      assert.deepEqual(notifications, [
        { summary: "Implemented.", verified: true },
      ]);
      assert.deepEqual(
        validationActivities.map(({ phase }) => phase),
        ["started", "finished"],
      );
      assert.equal(validationActivities[0]?.request.tool, "run_task");
      assert.equal(validationActivities[1]?.output, passedRunResult);
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

test("automatic validation prefers a declared typecheck over heavier tasks", async () => {
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
      await recordPendingChange(memory);
      await tool.execute(
        { summary: "Implemented.", verified: true },
        toolContext(),
      );
      assert.equal(
        nestedString(requests[0], "input", "task", "task_id"),
        "typecheck",
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

test("repairable validation permits one correction cycle without a retry loop", async () => {
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
      const result = await tool.execute(
        { summary: "Second submission", verified: true },
        toolContext(),
      );
      assert.match(String(result), /Validation non confirmée/);
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
    async ({ memory, tool }) => {
      await assert.rejects(
        tool.execute(
          { summary: "First submission", verified: true },
          toolContext(),
        ),
        /repairable code error/iu,
      );
      await recordPendingChange(memory, "src_11111111111111111111111111111111");
      const result = await tool.execute(
        { summary: "Corrected and complete.", verified: false },
        toolContext(),
      );
      assert.equal(result, "Corrected and complete.");
      assert.equal(calls, 2);
      assert.equal(notifications.at(-1)?.verified, true);
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

test("infrastructure validation failure completes with a deterministic caveat", async () => {
  const notifications: NativeCompletionNotification[] = [];
  await withCompletion(
    async ({ tool }) => {
      const result = await tool.execute(
        { summary: "Implemented.", verified: true },
        toolContext(),
      );
      assert.match(String(result), /Validation non confirmée/);
      assert.equal(notifications[0]?.verified, false);
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
    await recordPendingChange(memory);
    await memory.recordValidation({
      id: "run://passed",
      sourceRevisionId: "src_00000000000000000000000000000000",
      status: "passed",
      taskId: "test",
      taskKind: "test",
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
    beforeTool?(memory: ConversationMemoryStore): Promise<unknown>;
    executor?: SemanticWorkspaceExecutor;
    notifications?: NativeCompletionNotification[];
    onComplete?(
      notification: NativeCompletionNotification,
      memory: ConversationMemoryStore,
    ): Promise<void> | void;
    validationActivities?: NativeValidationActivity[];
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "blame-native-completion-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    const memory = new ConversationMemoryStore(root, "session");
    await memory.beginRequest({
      currentRequest: "Implement it.",
      userGoal: "Goal",
    });
    await options.beforeTool?.(memory);
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
      workspaceRoot: root,
    });
    await operation({ memory, root, tool });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function recordPendingChange(
  memory: ConversationMemoryStore,
  sourceRevisionId = "src_00000000000000000000000000000000",
) {
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
