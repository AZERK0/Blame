import assert from "node:assert/strict";
import test from "node:test";
import {
  createContextCompactionPrepareTurn,
  createProviderConfig,
  type Message,
} from "@cline/sdk";
import {
  createContextProjectionExtension,
  projectProviderContext,
  type ContextProjectionMetrics,
} from "./context-projection.js";

test("projects acknowledged edits and reads superseded after edits", () => {
  const original = projectionMessages();
  const projection = projectProviderContext(
    original,
    { systemPrompt: "system", tools: [{ name: "edit_code" }] },
    3,
  );
  const serialized = JSON.stringify(projection.messages);
  assert.doesNotMatch(serialized, /FIRST_PATCH|ORIGINAL_SOURCE/u);
  assert.match(serialized, /FRESH_SOURCE|LATEST_PATCH/u);
  assert.match(serialized, /FAILED_PATCH/u);
  assert.match(serialized, /superseded_after_edit/u);
  assert.match(JSON.stringify(original), /FIRST_PATCH|ORIGINAL_SOURCE/u);
  assert.equal(projection.metrics.requestIndex, 3);
  assert.equal(projection.metrics.staleReadsReplaced, 1);
  assert.equal(projection.metrics.successfulEditsReplaced, 1);
  assert.ok(projection.metrics.projectedBytesSaved > 0);
  assert.equal(projection.metrics.transcriptHash.length, 64);
});

test("preserves an edited path read until a fresh read replaces it", () => {
  const original = projectionMessages().slice(0, 4);
  const projection = projectProviderContext(original, {
    systemPrompt: "system",
    tools: [{ name: "edit_code" }],
  });
  assert.match(JSON.stringify(projection.messages), /ORIGINAL_SOURCE/u);
  assert.equal(projection.metrics.staleReadsReplaced, 0);
});

test("summarizes completed edits without teaching invalid tool arguments", () => {
  const original = projectionMessages();
  const before = JSON.stringify(original);
  const { messages } = projectProviderContext(original, {
    systemPrompt: "",
    tools: [],
  });
  const blocks = messages.flatMap((message) =>
    typeof message.content === "string" ? [] : message.content,
  );
  const calls = blocks.filter((block) => block.type === "tool_use");
  const results = blocks.filter((block) => block.type === "tool_result");
  for (const call of calls.filter((call) => call.name === "edit_code")) {
    assert.ok(Array.isArray(call.input.operations));
    assert.equal(call.input.acknowledged, undefined);
  }
  assert.deepEqual(
    results.map((result) => result.tool_use_id),
    calls.map((call) => call.id),
  );
  assert.match(JSON.stringify(messages), /Historical completed edit.*c1/u);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(
    projectProviderContext(messages, { systemPrompt: "", tools: [] }).messages,
    messages,
  );
});

test("preserves sibling calls, results and user instructions in a mixed batch", () => {
  const original = projectionMessages();
  const content = (index: number) =>
    original[index].content as Exclude<Message["content"], string>;
  const mixed: Message[] = [
    { role: "assistant", content: [...content(2), ...content(6)] },
    {
      role: "user",
      content: [
        ...content(3),
        ...content(7),
        { type: "text", text: "Keep keyboard navigation" },
      ],
    },
    original[4],
    original[5],
  ];
  const { messages } = projectProviderContext(mixed, {
    systemPrompt: "",
    tools: [],
  });
  const serialized = JSON.stringify(messages);
  assert.doesNotMatch(serialized, /FIRST_PATCH|"tool_use_id":"edit-1"/u);
  assert.match(serialized, /LATEST_PATCH/u);
  assert.match(serialized, /Keep keyboard navigation/u);
  assert.match(serialized, /"tool_use_id":"edit-2"/u);
});

test("never summarizes an errored tool result even if its payload says ok", () => {
  const original = projectionMessages();
  const result = original[3].content as Exclude<Message["content"], string>;
  assert.equal(result[0].type, "tool_result");
  if (result[0].type === "tool_result") result[0].is_error = true;
  const { messages } = projectProviderContext(original, {
    systemPrompt: "",
    tools: [],
  });
  assert.match(JSON.stringify(messages), /FIRST_PATCH/u);
});

test("preserves current edits independently until their paths are observed", () => {
  const messages = [
    toolUse("edit-a", "edit_code", editInput("src/a.ts", "CURRENT_A")),
    successfulEditResult("edit-a", "c1", "src/a.ts", "src_1"),
    toolUse("edit-b", "edit_code", editInput("src/b.ts", "CURRENT_B")),
    successfulEditResult("edit-b", "c2", "src/b.ts", "src_2"),
  ];
  const projection = projectProviderContext(messages, {
    systemPrompt: "system",
    tools: [{ name: "edit_code" }],
  });
  const serialized = JSON.stringify(projection.messages);
  assert.match(serialized, /CURRENT_A/u);
  assert.match(serialized, /CURRENT_B/u);
  assert.equal(projection.metrics.successfulEditsReplaced, 0);
});

test("compacts an edit after a fresh read while retaining another path", () => {
  const messages = [
    toolUse("edit-a", "edit_code", editInput("src/a.ts", "OBSERVED_A")),
    successfulEditResult("edit-a", "c1", "src/a.ts", "src_1"),
    toolUse("read-a", "read_code", { target: "src/a.ts" }),
    toolResult("read-a", "read_code", {
      data: { content: "CURRENT_A", path: "src/a.ts" },
      status: "ok",
    }),
    toolUse("edit-b", "edit_code", editInput("src/b.ts", "CURRENT_B")),
    successfulEditResult("edit-b", "c2", "src/b.ts", "src_2"),
  ];
  const projection = projectProviderContext(messages, {
    systemPrompt: "system",
    tools: [{ name: "edit_code" }],
  });
  const serialized = JSON.stringify(projection.messages);
  assert.doesNotMatch(serialized, /OBSERVED_A/u);
  assert.match(serialized, /CURRENT_A/u);
  assert.match(serialized, /CURRENT_B/u);
  assert.equal(projection.metrics.successfulEditsReplaced, 1);
});

test("compacts a large edit after validation of the current revision", () => {
  const largeContent = "LARGE_VALIDATED_EDIT".repeat(400);
  const messages = [
    toolUse("edit-a", "edit_code", editInput("src/a.ts", largeContent)),
    successfulEditResult("edit-a", "c1", "src/a.ts", "src_1"),
    toolUse("build", "run_task", { kind: "project", task: "build" }),
    validationResult("build", ["src/a.ts"], "src_1"),
  ];
  const projection = projectProviderContext(messages, {
    systemPrompt: "system",
    tools: [{ name: "edit_code" }],
  });
  assert.doesNotMatch(
    JSON.stringify(projection.messages),
    /LARGE_VALIDATED_EDIT/u,
  );
  assert.equal(projection.metrics.successfulEditsReplaced, 1);
  assert.equal(projection.metrics.validatedEditsReplaced, 1);
  assert.ok(projection.metrics.projectedBytesSaved > 4_096);
});

test("preserves edits when validation is stale or partial", () => {
  const large = "UNPROVEN_EDIT".repeat(400);
  const messages = [
    toolUse("edit-a", "edit_code", editInput("src/a.ts", large)),
    successfulEditResult("edit-a", "c1", "src/a.ts", "src_1"),
    toolUse("build", "run_task", { kind: "project", task: "build" }),
    validationResult("build", ["src/other.ts"], "src_1"),
    toolUse("edit-b", "edit_code", editInput("src/b.ts", "CURRENT_B")),
    successfulEditResult("edit-b", "c2", "src/b.ts", "src_2"),
  ];
  const projection = projectProviderContext(messages, {
    systemPrompt: "system",
    tools: [{ name: "edit_code" }],
  });
  const serialized = JSON.stringify(projection.messages);
  assert.match(serialized, /UNPROVEN_EDIT/u);
  assert.match(serialized, /CURRENT_B/u);
  assert.equal(projection.metrics.validatedEditsReplaced, 0);
});

test("preserves a small edit after validation", () => {
  const messages = [
    toolUse("edit-a", "edit_code", editInput("src/a.ts", "SMALL_EDIT")),
    successfulEditResult("edit-a", "c1", "src/a.ts", "src_1"),
    toolUse("build", "run_task", { kind: "project", task: "build" }),
    validationResult("build", ["src/a.ts"], "src_1"),
  ];
  const projection = projectProviderContext(messages, {
    systemPrompt: "system",
    tools: [{ name: "edit_code" }],
  });
  assert.match(JSON.stringify(projection.messages), /SMALL_EDIT/u);
  assert.equal(projection.metrics.validatedEditsReplaced, 0);
});

test("publishes content-free provider context measurements", async () => {
  const emitted: ContextProjectionMetrics[] = [];
  const extension = createContextProjectionExtension({
    emit: (metrics) => emitted.push(metrics),
    systemPrompt: "system",
    tools: [{ description: "Edit", name: "edit_code" }],
  });
  let build:
    | ((messages: Message[]) => Message[] | Promise<Message[]>)
    | undefined;
  await extension.setup?.(
    {
      registerMessageBuilder(builder: {
        build(messages: Message[]): Message[] | Promise<Message[]>;
      }) {
        build = builder.build;
      },
    } as never,
    {} as never,
  );
  await build?.(
    projectionMessages().map((message, index) => ({
      ...message,
      id: `message-${index}`,
    })) as Message[],
  );
  await build?.(projectionMessages());
  await build?.(projectionMessages());
  assert.equal(emitted.length, 2);
  assert.equal(emitted[1]?.requestIndex, 2);
  assert.ok((emitted[1]?.composedBytes ?? 0) > 0);
  assert.doesNotMatch(JSON.stringify(emitted), /ORIGINAL_SOURCE|FIRST_PATCH/u);
});

test("executes native Cline compaction on a long context", async () => {
  const notices: Array<{
    message: string;
    metadata?: Record<string, unknown>;
  }> = [];
  const prepare = nativeCompactionPrepareTurn();
  assert.ok(prepare);
  const messages = longMessages();
  const result = await prepare({
    abortSignal: new AbortController().signal,
    agentId: "agent",
    apiMessages: messages,
    conversationId: "conversation",
    emitStatusNotice: (message: string, metadata?: Record<string, unknown>) =>
      notices.push({ message, metadata }),
    iteration: messages.length,
    messages,
    model: {
      id: "fixture",
      info: { contextWindow: 3_000, maxInputTokens: 2_000 },
      provider: "anthropic",
    },
    parentAgentId: null,
    systemPrompt: "system",
    tools: [],
  });
  assert.ok(result);
  assert.ok(result.messages.length < messages.length);
  assert.ok(
    notices.some(
      ({ metadata }) =>
        metadata?.kind === "auto_compaction" && metadata.phase === "completed",
    ),
  );
});

function nativeCompactionPrepareTurn() {
  const providerConfig = createProviderConfig({
    apiKey: "fixture",
    model: "fixture",
    provider: "anthropic",
  });
  return createContextCompactionPrepareTurn({
    compaction: { enabled: true, strategy: "basic" },
    modelId: "fixture",
    providerConfig,
    providerId: "anthropic",
    sessionId: "long-context",
  });
}

function longMessages(): Message[] {
  return Array.from({ length: 30 }, (_, index) => ({
    content: `message ${index} ${"x".repeat(1_000)}`,
    role: index % 2 ? "assistant" : "user",
  }));
}

function projectionMessages(): Message[] {
  return [
    toolUse("read-1", "read_code", { target: "src/a.ts" }),
    toolResult("read-1", "read_code", {
      data: { content: "ORIGINAL_SOURCE".repeat(100), path: "src/a.ts" },
      receipt: "r1",
      status: "ok",
    }),
    toolUse("edit-1", "edit_code", {
      operations: [
        { kind: "patch", patch: "FIRST_PATCH".repeat(100), path: "src/a.ts" },
      ],
    }),
    successfulEditResult("edit-1", "c1", "src/a.ts", "src_1"),
    toolUse("read-2", "read_code", { target: "src/a.ts" }),
    toolResult("read-2", "read_code", {
      data: { content: "FRESH_SOURCE", path: "src/a.ts" },
      receipt: "r2",
      status: "ok",
    }),
    toolUse("edit-2", "edit_code", {
      operations: [{ kind: "patch", patch: "LATEST_PATCH", path: "src/b.ts" }],
    }),
    successfulEditResult("edit-2", "c2", "src/b.ts", "src_2"),
    toolUse("edit-3", "edit_code", {
      operations: [{ kind: "patch", patch: "FAILED_PATCH", path: "src/c.ts" }],
    }),
    toolResult("edit-3", "edit_code", { status: "blocked" }),
  ];
}

function successfulEditResult(
  id: string,
  receipt: string,
  path: string,
  sourceRevisionId: string,
) {
  return toolResult(id, "edit_code", {
    data: { changes: [{ path }], sourceRevisionId },
    receipt,
    status: "ok",
  });
}

function validationResult(
  id: string,
  paths: string[],
  sourceRevisionId: string,
) {
  return toolResult(id, "run_task", {
    data: {
      validation: {
        paths,
        sourceRevisionId,
        status: "passed",
        taskKind: "build",
      },
    },
    status: "ok",
  });
}

function editInput(path: string, content: string) {
  return { operations: [{ kind: "patch", patch: content, path }] };
}

function toolUse(
  id: string,
  name: string,
  input: Record<string, unknown>,
): Message {
  return {
    content: [{ id, input, name, type: "tool_use" }],
    role: "assistant",
  };
}

function toolResult(id: string, name: string, output: unknown): Message {
  return {
    content: [
      {
        content: JSON.stringify(output),
        name,
        tool_use_id: id,
        type: "tool_result",
      },
    ],
    role: "user",
  };
}
