import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ClineCoreStartInput, CoreSessionEvent } from "@cline/sdk";
import { ClineFreeModelLimitError, ClineNotSubscribedError } from "@cline/llms";
import { ConversationMemoryStore } from "./harness/conversation-memory.js";
import { SemanticWorkspace } from "./harness/semantic-workspace.js";
import type { AgentEvent } from "./types.js";

import {
  buildDevelopmentSystemPrompt,
  BlameAgentRuntime,
  backendKey,
  clineErrorMetadata,
  coreBackendOptions,
  developmentUserInput,
  duplicateEventSignature,
  initializationToolPolicies,
  nextSpawnAgentActiveCount,
  newProjectGenerationToolPolicies,
  normalizeClineAgentPayload,
  resultFailureMessage,
  shouldDisplayClineSessionEvent,
  terminalToolEvent,
  workspaceSessionIds,
} from "./cline-runtime.js";

test("exposes actionable metadata for typed Cline account errors", () => {
  assert.deepEqual(clineErrorMetadata(new ClineNotSubscribedError("cline")), {
    actionUrl: "https://app.cline.bot/dashboard/subscription?personal=true",
    code: "cline_not_subscribed",
  });
  assert.deepEqual(
    clineErrorMetadata(
      new ClineFreeModelLimitError("Free model limit reached", "cline"),
    ),
    {
      code: "cline_free_model_limit",
      resetAt: undefined,
    },
  );
});

test("uses the local backend when no workspace backend is provided", () => {
  assert.equal(backendKey(), "local");
  assert.deepEqual(coreBackendOptions(), { backendMode: "local" });
});

test("tags session events with their execution identity", () => {
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    sessionExecutionIds: Map<string, string>;
    withExecutionId(
      sessionId: string,
      event: AgentEvent,
      executionId?: string,
    ): AgentEvent;
  };
  internals.sessionExecutionIds.set("session", "execution-current");
  const event = { payload: {}, sessionId: "session", type: "done" } as const;

  assert.equal(
    internals.withExecutionId("session", event).executionId,
    "execution-current",
  );
  assert.equal(
    internals.withExecutionId("session", event, "execution-original")
      .executionId,
    "execution-original",
  );
});

test("hides submit_and_exit cards and projects only its native summary", () => {
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    sessionSubmittedSummaries: Map<string, string>;
    withSubmittedSummary(sessionId: string, event: AgentEvent): AgentEvent;
  };
  internals.sessionSubmittedSummaries.set("session", "Visible answer");
  assert.equal(
    terminalToolEvent({
      type: "tool",
      sessionId: "session",
      payload: { toolCall: { name: "submit_and_exit" } },
    }),
    true,
  );
  const done = internals.withSubmittedSummary("session", {
    type: "done",
    sessionId: "session",
    payload: { text: "internal completion output" },
  });
  assert.equal((done.payload as { text: string }).text, "Visible answer");
});

test("publishes automatic validation as a stable run_task activity", async () => {
  const events: AgentEvent[] = [];
  const runtime = new BlameAgentRuntime({
    emit: (event) => events.push(event),
  });
  const internals = runtime as unknown as {
    publishNativeValidationActivity(
      sessionId: string,
      activity: {
        output?: unknown;
        phase: "finished" | "started";
        request: { input: unknown };
        toolCallId: string;
      },
    ): Promise<void>;
  };
  const request = { input: { task: { task_id: "typecheck" } } };
  await internals.publishNativeValidationActivity("session", {
    phase: "started",
    request,
    toolCallId: "submit:validation",
  });
  await internals.publishNativeValidationActivity("session", {
    output: { status: "success", data: { status: "passed" } },
    phase: "finished",
    request,
    toolCallId: "submit:validation",
  });
  assert.deepEqual(
    events.map((event) => (event.payload as { phase: string }).phase),
    ["started", "finished"],
  );
  const finished = events[1]?.payload as Record<string, unknown>;
  assert.equal(finished.toolName, "run_task");
  assert.equal(finished.toolCallId, "submit:validation");
  assert.equal(finished.sequenceNumber, 1);
  assert.deepEqual(
    (finished.toolCall as { input: unknown }).input,
    request.input,
  );
});

test("prewarms and removes the reserved remote runtime session", async () => {
  const calls: string[] = [];
  const core = {
    abort: async (sessionId: string) => {
      calls.push(`abort:${sessionId}`);
    },
    delete: async (sessionId: string) => {
      calls.push(`delete:${sessionId}`);
      return true;
    },
    stop: async (sessionId: string) => {
      calls.push(`stop:${sessionId}`);
    },
    start: async (input: { config: { sessionId?: string } }) => {
      calls.push(`start:${input.config.sessionId}`);
      return { sessionId: input.config.sessionId! };
    },
  };
  const runtime = new BlameAgentRuntime(undefined, {
    createCore: async () => core as never,
  });

  await runtime.prewarm({
    backend: {
      endpoint: "ws://127.0.0.1:25463/hub",
      mode: "remote",
    },
    cwd: "/tmp/blame-prewarm",
    workspaceRoot: "/tmp/blame-prewarm",
  });

  assert.deepEqual(calls, [
    "start:blame-runtime-prewarm",
    "stop:blame-runtime-prewarm",
    "abort:blame-runtime-prewarm",
    "delete:blame-runtime-prewarm",
  ]);
});

test("does not prewarm a local Cline backend", async () => {
  let created = false;
  const runtime = new BlameAgentRuntime(undefined, {
    createCore: async () => {
      created = true;
      return {} as never;
    },
  });

  await runtime.prewarm({
    backend: { mode: "local" },
    cwd: "/tmp/blame-prewarm",
    workspaceRoot: "/tmp/blame-prewarm",
  });

  assert.equal(created, false);
});

test("starts development sessions with native skills and private specialist consultation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-development-runtime-"));
  const workspaceSkillDirectory = join(
    workspace,
    ".cline",
    "skills",
    "workspace-skill",
  );
  await mkdir(workspaceSkillDirectory, { recursive: true });
  await writeFile(
    join(workspaceSkillDirectory, "SKILL.md"),
    [
      "---",
      "name: workspace-skill",
      "description: Workspace-owned regression fixture.",
      "---",
      "",
      "# Workspace skill",
    ].join("\n"),
  );
  const originalFetch = globalThis.fetch;
  let capturedStart: ClineCoreStartInput | undefined;
  let tokenCounterInput: { modelId: string; providerId: string } | undefined;
  const core = {
    async dispose() {},
    async list() {
      return [];
    },
    async start(input: ClineCoreStartInput) {
      capturedStart = input;
      return { sessionId: input.config.sessionId! };
    },
    async subscribe() {
      return () => undefined;
    },
  };
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        data: {
          apiKey: "provider-key",
          authMethod: "api-key",
          baseUrl: null,
          id: "credential",
          label: "default",
          providerId: "provider",
        },
      }),
      { headers: { "content-type": "application/json" }, status: 200 },
    );
  const runtime = new BlameAgentRuntime(undefined, {
    createCore: async () => core as never,
    tokenCounter: (input) => {
      tokenCounterInput = input;
      return {
        strategy: "provider_tokenizer",
        count: (text) => Math.ceil(text.length / 3),
      };
    },
  });

  try {
    await runtime.sessions.startDevelopment({
      apiConnection: { url: "https://api.example" },
      autoSendPrompt: false,
      cwd: workspace,
      modelId: "model",
      providerId: "provider",
      summary: "Improve the settings experience",
      title: "Settings polish",
      workspaceRoot: workspace,
    });

    assert.ok(capturedStart);
    assert.deepEqual(tokenCounterInput, {
      modelId: "model",
      providerId: "provider",
    });
    assert.equal(capturedStart.config.enableSpawnAgent, false);
    assert.ok(capturedStart.localRuntime?.configExtensions?.includes("skills"));
    assert.ok(
      capturedStart.localRuntime?.configExtensions?.includes("plugins"),
    );
    assert.equal(capturedStart.config.pluginPaths, undefined);
    assert.equal("pluginPaths" in (capturedStart.localRuntime ?? {}), false);
    const skillService = capturedStart.localRuntime?.userInstructionService;
    assert.ok(skillService);
    const skillNames = skillService
      .listRecords("skill")
      .map((record: { item: { name: string } }) => record.item.name);
    assert.ok(skillNames.includes("impeccable"));
    assert.ok(skillNames.includes("workspace-skill"));
    const toolNames = capturedStart.config.extraTools?.map(
      (tool: { name: string }) => tool.name,
    );
    assert.ok(toolNames?.includes("consult_specialist"));
    assert.ok(toolNames?.includes("submit_and_exit"));
    assert.equal(
      capturedStart.config.extraTools?.find(
        (tool: { name: string }) => tool.name === "submit_and_exit",
      )?.lifecycle?.completesRun,
      true,
    );
    assert.equal(
      capturedStart.config.extraTools?.filter(
        (tool: { lifecycle?: { completesRun?: boolean } }) =>
          tool.lifecycle?.completesRun,
      ).length,
      1,
    );
    assert.equal(toolNames?.includes("spawn_agent"), false);
    assert.deepEqual(capturedStart.toolPolicies?.consult_specialist, {
      autoApprove: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
    await runtime.shutdown();
    await rm(workspace, { force: true, recursive: true });
  }
});

test("continues the agent turn after bounding a large web fetch result", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-bounded-fetch-"));
  const originalFetch = globalThis.fetch;
  const originalGovernorFlag = process.env.BLAME_COST_GOVERNOR_V2;
  let continuedAfterFetch = false;
  const core = {
    async dispose() {},
    async list() {
      return [];
    },
    async start(input: ClineCoreStartInput) {
      const afterTool = input.config.hooks?.afterTool;
      assert.ok(afterTool);
      const update = await afterTool({
        durationMs: 10,
        endedAt: new Date(),
        input: { requests: [{ url: "https://example.com/large" }] },
        result: {
          output: [
            {
              query: "https://example.com/large",
              result: "large content ".repeat(2_000),
              success: true,
            },
          ],
          isError: false,
          metadata: { requestId: "fetch-request" },
        },
        snapshot: {},
        startedAt: new Date(),
        tool: { name: "fetch_web_content" },
        toolCall: {},
      } as never);
      const output = update?.result?.output as Array<{ result: string }>;
      continuedAfterFetch = output.map((item) => item.result).length === 1;
      return { result: { status: "done" }, sessionId: input.config.sessionId! };
    },
    async subscribe() {
      return () => undefined;
    },
  };
  globalThis.fetch = async () => providerCredentialResponse();
  process.env.BLAME_COST_GOVERNOR_V2 = "true";
  const runtime = new BlameAgentRuntime(undefined, {
    createCore: async () => core as never,
  });

  try {
    await runtime.sessions.startDevelopment({
      apiConnection: { url: "https://api.example" },
      autoSendPrompt: false,
      cwd: workspace,
      modelId: "model",
      providerId: "provider",
      summary: "Continue after web research",
      title: "Bounded web fetch",
      workspaceRoot: workspace,
    });
    assert.equal(continuedAfterFetch, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalGovernorFlag === undefined)
      delete process.env.BLAME_COST_GOVERNOR_V2;
    else process.env.BLAME_COST_GOVERNOR_V2 = originalGovernorFlag;
    await runtime.shutdown();
    await rm(workspace, { force: true, recursive: true });
  }
});

test("compaction preserves an unfinished multi-file edit", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-live-compaction-"));
  const fixture = developmentCompactionFixture("true");
  try {
    const sessionId = "unfinished-edit-compaction";
    await fixture.runtime.sessions.startDevelopment({
      apiConnection: { url: "https://api.example" },
      autoSendPrompt: false,
      cwd: workspace,
      maxIterations: 80,
      modelId: "model",
      providerId: "provider",
      sessionId,
      summary: "Create both unfinished files and validate them later.",
      title: "Unfinished edit",
      workspaceRoot: workspace,
    });
    await applyUnfinishedEdit(workspace, sessionId);
    const update = await compactAtCheckpoint(fixture.start());
    const serialized = JSON.stringify(update?.messages);
    assert.match(serialized, /Create both unfinished files/);
    assert.match(serialized, /src\/first\.ts/);
    assert.match(serialized, /src\/second\.ts/);
    const memory = new ConversationMemoryStore(workspace, sessionId);
    assert.ok((await memory.completionState()).requiredValidation);
  } finally {
    await fixture.restore();
    await rm(workspace, { force: true, recursive: true });
  }
});

test("disabled compaction keeps only the non-persistent continuity projection", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-no-compaction-"));
  const fixture = developmentCompactionFixture("false");
  try {
    await fixture.runtime.sessions.startDevelopment({
      apiConnection: { url: "https://api.example" },
      autoSendPrompt: false,
      cwd: workspace,
      maxIterations: 80,
      modelId: "model",
      providerId: "provider",
      summary: "Keep the complete context.",
      title: "No compaction",
      workspaceRoot: workspace,
    });
    assert.equal(fixture.start()?.config.compaction?.enabled, false);
    assert.equal(fixture.start()?.config.compaction?.compact, undefined);
    const projection = await compactAtCheckpoint(fixture.start());
    assert.match(JSON.stringify(projection?.messages), /blame_continuity/);
    assert.doesNotMatch(
      JSON.stringify(projection?.messages),
      /compaction_reason|execution_epoch_id/,
    );
  } finally {
    await fixture.restore();
    await rm(workspace, { force: true, recursive: true });
  }
});

test("gives project generation direct write tools without global skills", () => {
  const policies = newProjectGenerationToolPolicies();

  for (const name of ["run_commands", "editor", "apply_patch"]) {
    assert.deepEqual(policies[name], { enabled: true, autoApprove: true });
  }
  assert.deepEqual(policies.skills, { enabled: false, autoApprove: false });
  assert.deepEqual(policies.ask_question, {
    enabled: false,
    autoApprove: false,
  });
});

test("rejects a successful project generation session that created no project", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-new-project-runtime-"));
  const fixture = newProjectGenerationFixture();

  try {
    await assert.rejects(
      fixture.runtime.newProjects.generate(
        newProjectGenerationInput(workspace),
      ),
      /completed without creating a package\.json/,
    );
    assert.deepEqual(fixture.start()?.localRuntime?.configExtensions, [
      "rules",
    ]);
    assert.equal(fixture.start()?.toolPolicies?.skills?.enabled, false);
    assert.equal(fixture.start()?.toolPolicies?.run_commands?.enabled, true);
  } finally {
    await fixture.restore();
    await rm(workspace, { force: true, recursive: true });
  }
});

function newProjectGenerationFixture() {
  const originalFetch = globalThis.fetch;
  let capturedStart: ClineCoreStartInput | undefined;
  const core = {
    async dispose() {},
    async list() {
      return [];
    },
    async start(input: ClineCoreStartInput) {
      capturedStart = input;
      return { result: { status: "done" }, sessionId: input.config.sessionId! };
    },
    async subscribe() {
      return () => undefined;
    },
  };
  globalThis.fetch = async () => providerCredentialResponse();
  const runtime = new BlameAgentRuntime(undefined, {
    createCore: async () => core as never,
  });
  return {
    runtime,
    start: () => capturedStart,
    async restore() {
      globalThis.fetch = originalFetch;
      await runtime.shutdown();
    },
  };
}

function providerCredentialResponse() {
  return new Response(
    JSON.stringify({
      data: {
        apiKey: "provider-key",
        authMethod: "api-key",
        baseUrl: null,
        id: "credential",
        label: "default",
        providerId: "provider",
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

function developmentCompactionFixture(enabled: "false" | "true") {
  const originalFetch = globalThis.fetch;
  const originalEnabled = process.env.BLAME_AGENT_COMPACTION_ENABLED;
  let capturedStart: ClineCoreStartInput | undefined;
  const core = {
    async dispose() {},
    async list() {
      return [];
    },
    async start(input: ClineCoreStartInput) {
      capturedStart = input;
      return { sessionId: input.config.sessionId! };
    },
    async subscribe() {
      return () => undefined;
    },
  };
  process.env.BLAME_AGENT_COMPACTION_ENABLED = enabled;
  globalThis.fetch = async () => providerCredentialResponse();
  const runtime = new BlameAgentRuntime(undefined, {
    createCore: async () => core as never,
  });
  return compactionFixtureResult(
    runtime,
    () => capturedStart,
    originalFetch,
    originalEnabled,
  );
}

function compactionFixtureResult(
  runtime: BlameAgentRuntime,
  start: () => ClineCoreStartInput | undefined,
  originalFetch: typeof globalThis.fetch,
  originalEnabled: string | undefined,
) {
  return {
    runtime,
    start,
    async restore() {
      globalThis.fetch = originalFetch;
      if (originalEnabled === undefined)
        delete process.env.BLAME_AGENT_COMPACTION_ENABLED;
      else process.env.BLAME_AGENT_COMPACTION_ENABLED = originalEnabled;
      await runtime.shutdown();
    },
  };
}

async function applyUnfinishedEdit(root: string, sessionId: string) {
  const workspace = new SemanticWorkspace(root, {
    taskContract: { session_id: sessionId },
  });
  const result = await workspace.editFiles({
    operations: [
      {
        operation: "create_file",
        path: "src/first.ts",
        content: "export {}\n",
      },
      {
        operation: "create_file",
        path: "src/second.ts",
        content: "export {}\n",
      },
    ],
  });
  assert.equal(result.status, "success");
}

function compactAtCheckpoint(start: ClineCoreStartInput | undefined) {
  assert.ok(start?.config.hooks?.beforeModel);
  return start.config.hooks.beforeModel({
    request: {
      messages: [
        { role: "user", content: [{ type: "text", text: "request" }] },
        { role: "assistant", content: [{ type: "text", text: "working" }] },
      ],
      tools: [],
    },
    snapshot: { iteration: 70 },
  } as never);
}

function newProjectGenerationInput(workspace: string) {
  return {
    apiConnection: { url: "https://api.example" },
    configuration: {
      advancedOptions: [],
      backend: "next-api",
      codeQuality: "eslint",
      database: "none",
      frontend: "next",
      orm: "none",
      packageManager: "pnpm",
      platform: "web",
      styling: "tailwind",
      uiLibrary: "none",
    },
    cwd: workspace,
    modelId: "model",
    projectName: "portfolio",
    providerId: "provider",
    sessionId: "new-project-session",
    workspaceRoot: workspace,
  };
}

test("synchronizes provider OAuth settings for initialization credentials", async () => {
  const calls: string[] = [];
  const credential = { providerId: "openai-codex" };
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    initializationCredential(input: unknown): Promise<typeof credential>;
    runtimeCredential(input: unknown): Promise<typeof credential>;
    syncClineOAuthProviderSettings(input: typeof credential): Promise<void>;
  };
  internals.runtimeCredential = async () => {
    calls.push("resolve");
    return credential;
  };
  internals.syncClineOAuthProviderSettings = async (input) => {
    assert.equal(input, credential);
    calls.push("sync");
  };

  assert.equal(await internals.initializationCredential({}), credential);
  assert.deepEqual(calls, ["resolve", "sync"]);
});

test("finds only sessions writing inside a workspace", () => {
  const workspace = join(tmpdir(), "story-42");
  const sessions = new Map([
    ["inside", join(workspace, ".blame", "logs", "cline-inside.log")],
    ["sibling", join(`${workspace}-copy`, ".blame", "logs", "cline.log")],
    ["parent", join(tmpdir(), ".blame", "logs", "cline.log")],
  ]);

  assert.deepEqual(workspaceSessionIds(sessions, workspace), ["inside"]);
});

test("drains session logs before workspace cleanup", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-worktree-cleanup-"));
  const logFile = join(workspace, ".blame", "logs", "cline-session.log");
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    abortSession(sessionId: string, humanInitiated: boolean): Promise<void>;
    sessionLogFiles: Map<string, string>;
  };
  internals.abortSession = async () => undefined;
  internals.sessionLogFiles.set("session", logFile);

  try {
    await runtime.sessions.releaseWorkspace(workspace);
    assert.match(await readFile(logFile, "utf8"), /session_unsubscribed/);
    await rm(workspace, { force: true, recursive: true });
    await runtime.sessions.unsubscribe("session");
    await assert.rejects(access(workspace));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("does not write high-frequency streaming events to the session log", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "blame-stream-log-"));
  const logFile = join(workspace, "cline-session.log");
  const runtime = new BlameAgentRuntime();
  const internals = runtime as unknown as {
    handleSessionEvent(sessionId: string, event: AgentEvent): Promise<void>;
    sessionLogFiles: Map<string, string>;
  };
  internals.sessionLogFiles.set("session", logFile);

  try {
    await internals.handleSessionEvent("session", {
      payload: { text: "streamed chunk" },
      sessionId: "session",
      type: "text",
    });
    await assert.rejects(access(logFile));
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
});

test("limits initialization fallback tools to project reads and search", () => {
  const policies = initializationToolPolicies();

  assert.deepEqual(policies.read_files, { enabled: true, autoApprove: true });
  assert.deepEqual(policies.search_codebase, {
    enabled: true,
    autoApprove: true,
  });
  assert.deepEqual(policies.fetch_web_content, disabledToolPolicy());
  assert.deepEqual(policies.get_preview_devtools, disabledToolPolicy());
  assert.deepEqual(policies.get_preview_container_logs, disabledToolPolicy());
  assert.deepEqual(policies.run_commands, disabledToolPolicy());
  assert.deepEqual(policies.editor, disabledToolPolicy());
  assert.deepEqual(policies.apply_patch, disabledToolPolicy());
});

test("hides teammate agent content events", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(
      agentEvent(
        { type: "content_start", contentType: "text", text: "hidden" },
        "teammate",
      ),
    ),
    false,
  );
});

test("keeps teammate usage events", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(agentEvent({ type: "usage" }, "teammate")),
    true,
  );
});

test("hides sub-agent hook events", () => {
  assert.equal(shouldDisplayClineSessionEvent(hookEvent("child-agent")), false);
});

test("keeps lead hook events", () => {
  assert.equal(shouldDisplayClineSessionEvent(hookEvent()), true);
});

test("normalizes SDK agent errors with their message and recovery state", () => {
  const event = normalizeClineAgentPayload(
    {
      error: new Error("Provider unavailable"),
      iteration: 3,
      recoverable: true,
      type: "error",
    },
    "session",
    "raw",
  );

  assert.equal(event.type, "error");
  assert.deepEqual(event.payload, {
    iteration: 3,
    message: "Provider unavailable",
    recoverable: true,
    raw: "raw",
  });
});

test("formats failed agent results without a provider label", () => {
  const detailed = resultFailureMessage({
    finishReason: "error",
    error: new Error("Provider unavailable"),
  });
  const iterationLimit = resultFailureMessage({
    finishReason: "max_iterations",
    text: '{"status":"blocked","completionAllowed":false}',
  });
  const hyphenatedIterationLimit = resultFailureMessage({
    finishReason: "max-iterations",
  });
  const conflictingIterationLimit = resultFailureMessage({
    status: "done",
    finishReason: "max_iterations",
  });
  const generic = resultFailureMessage({ finishReason: "mistake_limit" });

  assert.equal(detailed, "Provider unavailable");
  assert.equal(
    iterationLimit,
    "Agent stopped after reaching its work-step limit before submitting a final response.",
  );
  assert.equal(
    hyphenatedIterationLimit,
    "Agent stopped after reaching its work-step limit before submitting a final response.",
  );
  assert.equal(conflictingIterationLimit, iterationLimit);
  assert.equal(
    generic,
    "Agent stopped after repeated unsuccessful actions before submitting a final response.",
  );
  assert.doesNotMatch(`${detailed} ${generic}`, /cline/i);
});

test("never projects an internal payload as the final assistant response", () => {
  const internalPayload = JSON.stringify({
    status: "blocked",
    completionAllowed: false,
    reason: "NO_POST_EDIT_VALIDATION",
  });
  const event = normalizeClineAgentPayload(
    {
      type: "done",
      reason: "max_iterations",
      text: internalPayload,
      iteration: 80,
    },
    "session",
    internalPayload,
  );

  assert.equal(event.type, "error");
  assert.equal(
    (event.payload as { message?: string }).message,
    "Agent stopped after reaching its work-step limit before submitting a final response.",
  );
  assert.doesNotMatch(JSON.stringify(event.payload), /completionAllowed/iu);
  assert.doesNotMatch(JSON.stringify(event.payload), /Work completed/iu);
});

test("keeps unknown tool payloads out of assistant text events", () => {
  const event = normalizeClineAgentPayload(
    {
      type: "tool-result",
      toolCallId: "internal-tool",
      content: '{"status":"blocked"}',
    },
    "session",
    "raw",
  );

  assert.equal(event.type, "raw");
});

test("hides untagged sub-agent text while spawn agent is active", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(
      agentEvent({
        type: "content_start",
        contentType: "text",
        text: "hidden",
      }),
      true,
    ),
    false,
  );
});

test("hides untagged sub-agent tools while spawn agent is active", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(
      agentEvent({
        type: "content_start",
        contentType: "tool",
        toolName: "read_files",
      }),
      true,
    ),
    false,
  );
});

test("keeps spawn agent tool events while spawn agent is active", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(
      agentEvent({
        type: "content_end",
        contentType: "tool",
        toolName: "spawn_agent",
      }),
      true,
    ),
    true,
  );
});

test("keeps usage events while spawn agent is active", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(agentEvent({ type: "usage" }), true),
    true,
  );
});

test("keeps spawn agent hook result while spawn agent is active", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(
      hookEvent(undefined, "spawn_agent", "tool_result"),
      true,
    ),
    true,
  );
});

test("tracks multiple parallel spawn agents", () => {
  let activeCount = 0;
  activeCount = nextSpawnAgentActiveCount(activeCount, "started");
  activeCount = nextSpawnAgentActiveCount(activeCount, "started");
  activeCount = nextSpawnAgentActiveCount(activeCount, "started");
  activeCount = nextSpawnAgentActiveCount(activeCount, "finished");
  assert.equal(activeCount, 2);
});

test("does not deduplicate spawn agent tools by tool name", () => {
  assert.equal(duplicateEventSignature(toolEvent("spawn_agent")), undefined);
});

test("keeps duplicate signatures for regular tools", () => {
  assert.equal(
    duplicateEventSignature(toolEvent("read_files")),
    "session:call-read_files:started:0",
  );
});

test("tool lifecycle identity separates parallel tools and every phase", () => {
  const first = toolEvent("read_files", "call-a", "started", 0);
  const second = toolEvent("read_files", "call-b", "started", 0);
  const progress = toolEvent("read_files", "call-a", "progress", 1);
  const finished = toolEvent("read_files", "call-a", "finished", 2);
  assert.notEqual(
    duplicateEventSignature(first),
    duplicateEventSignature(second),
  );
  assert.notEqual(
    duplicateEventSignature(first),
    duplicateEventSignature(progress),
  );
  assert.notEqual(
    duplicateEventSignature(progress),
    duplicateEventSignature(finished),
  );
});

test("cancelled tools and reconnect replays retain stable identities", () => {
  const cancelled = toolEvent("run_task", "manual-stop", "cancelled", 3);
  const replay = toolEvent("run_task", "manual-stop", "cancelled", 3);
  assert.equal(
    duplicateEventSignature(cancelled),
    duplicateEventSignature(replay),
  );
  assert.match(duplicateEventSignature(cancelled) ?? "", /cancelled:3$/u);
});

test("normalizes tool lifecycle metadata without delaying fast tools", () => {
  const runtime = new BlameAgentRuntime();
  const lifecycle = (
    runtime as unknown as {
      withToolLifecycle(sessionId: string, event: AgentEvent): AgentEvent;
    }
  ).withToolLifecycle.bind(runtime);
  const started = lifecycle(
    "session",
    toolEvent("read_files", "fast", "started", 0),
  );
  const finished = lifecycle(
    "session",
    toolEvent("read_files", "fast", "finished", 1),
  );
  assert.equal((started.payload as { phase: string }).phase, "started");
  assert.equal((finished.payload as { phase: string }).phase, "finished");
  assert.equal(
    (finished.payload as { sequenceNumber: number }).sequenceNumber,
    1,
  );
  assert.equal(
    typeof (finished.payload as { timestamp: string }).timestamp,
    "string",
  );
});

test("keeps development feedback attachments out of the prompt", async () => {
  const attachmentDirectory = await mkdtemp(join(tmpdir(), "blame-test-"));
  try {
    const input = await developmentUserInput(
      {
        feedback: "Use these files",
        feedbackFileAttachments: [
          fileAttachment("screenshot.png", "image/png"),
          fileAttachment("notes.txt", "text/plain"),
        ],
        feedbackOnly: true,
        summary: "Summary",
        title: "Title",
      },
      attachmentDirectory,
    );

    assert.equal(input.userImages.length, 1);
    assert.equal(input.userFiles.length, 1);
    assert.match(input.userImages[0] ?? "", /^data:image\/png;base64,/);
    assert.equal(input.userFiles[0]?.startsWith(attachmentDirectory), true);
    assert.doesNotMatch(input.prompt, /data:image\/png;base64,/);
    assert.doesNotMatch(input.prompt, /aGVsbG8=/);
    assert.equal(input.prompt.includes(attachmentDirectory), false);
    assert.match(input.prompt, /Images attached for model vision: 1/);
    assert.match(input.prompt, /Files attached for Cline context: 1/);
  } finally {
    await rm(attachmentDirectory, { force: true, recursive: true });
  }
});

test("uses local attachment content without downloading its stored copy", async () => {
  const attachmentDirectory = await mkdtemp(join(tmpdir(), "blame-test-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("Stored attachment should not be downloaded");
  };

  try {
    const input = await developmentUserInput(
      {
        fileAttachments: [
          {
            ...fileAttachment("screenshot.png", "image/png"),
            downloadUrl: "https://storage.example/screenshot",
          },
        ],
        summary: "Summary",
        title: "Title",
      },
      attachmentDirectory,
    );

    assert.deepEqual(input.userImages, ["data:image/png;base64,aGVsbG8="]);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(attachmentDirectory, { force: true, recursive: true });
  }
});

test("renews an expired attachment download URL", async () => {
  const attachmentDirectory = await mkdtemp(join(tmpdir(), "blame-test-"));
  const originalFetch = globalThis.fetch;
  const requests: Array<{ authorization?: string; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({
      authorization:
        new Headers(init?.headers).get("authorization") ?? undefined,
      url,
    });
    if (url === "https://storage.example/expired") {
      return new Response(null, { status: 403 });
    }
    if (url.endsWith("/attachments/attachment-id")) {
      return Response.json({
        downloadUrl: "https://storage.example/current",
      });
    }
    return new Response("hello");
  };

  try {
    const input = await developmentUserInput(
      {
        apiConnection: { token: "token", url: "https://api.example/api/v1" },
        feedbackFileAttachments: [
          {
            downloadUrl: "https://storage.example/expired",
            id: "attachment-id",
            name: "notes.txt",
            size: 5,
            type: "text/plain",
          },
        ],
        feedbackOnly: true,
        summary: "Summary",
        title: "Title",
      },
      attachmentDirectory,
    );

    assert.equal(await readFile(input.userFiles[0]!, "utf8"), "hello");
    assert.equal(requests[1]?.authorization, "Bearer token");
    assert.deepEqual(
      requests.map((request) => request.url),
      [
        "https://storage.example/expired",
        "https://api.example/api/v1/attachments/attachment-id",
        "https://storage.example/current",
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(attachmentDirectory, { force: true, recursive: true });
  }
});

test("renders the compact native Cline development prompt", async () => {
  const prompt = await buildDevelopmentSystemPrompt({
    apiConnection: { token: "token", url: "https://example.com" },
    codePractices: [
      { enabled: true, practice: "coding_style" },
      { enabled: false, practice: "layered_architecture" },
      { enabled: true, practice: "unit_tests" },
    ],
    cwd: process.cwd(),
    modelId: "model",
    providerId: "provider",
    summary: "Summary",
    title: "Title",
    workspaceRoot: process.cwd(),
  });

  assert.match(prompt, /^# Blame Development Agent/);
  assert.match(prompt, /<runtime_context>/);
  assert.match(prompt, /<workspace_metadata>/);
  assert.match(prompt, /Use Blame tools to inspect, modify, and validate/);
  assert.match(prompt, /Do not repeat a read, search, or inspection/);
  assert.match(prompt, /## Code navigation policy/);
  assert.match(prompt, /targeted `outline_code`/);
  assert.match(prompt, /inspect the needed symbol/);
  assert.match(prompt, /Truncated output: narrow/);
  assert.match(prompt, /genuinely bounded range/);
  assert.match(prompt, /runtime-generated `task_briefing`/);
  assert.match(prompt, /genuinely new unresolved API question/);
  assert.match(prompt, /concrete declaration is indispensable/);
  assert.match(prompt, /Iteration count alone never/);
  assert.doesNotMatch(prompt, /small directory|multiple complete reads/);
  assert.match(prompt, /call `submit_and_exit` exactly once/);
  assert.doesNotMatch(prompt, /complete_turn/);
  assert.doesNotMatch(prompt, /continuity_update|change_receipt_refs/);
  assert.doesNotMatch(prompt, /execution[_ ]epoch/iu);
  assert.match(prompt, /## Blame Specialist Consultations/);
  assert.match(prompt, /consult_specialist/);
  assert.match(prompt, /private instructions internally/);
  assert.doesNotMatch(prompt, /<system_prompt/);
  assert.doesNotMatch(prompt, /## Specialist knowledge/);
  assert.doesNotMatch(prompt, /Jobs To Be Done/);
  assert.doesNotMatch(prompt, /Gestalt grouping/);
  assert.ok(prompt.length < 15_000);
  assert.match(prompt, /## Coding Style: Standard Industrial Professional/);
  assert.match(prompt, /## Architecture: Match Codebase/);
  assert.match(prompt, /## Unit Tests: Professional TDD/);
  assert.match(
    prompt,
    new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.doesNotMatch(prompt, /\{\{[A-Z_]+\}\}/);
  assert.doesNotMatch(prompt, /You are Cline/);
  assert.doesNotMatch(prompt, /CLINE_RULES|CLINE_METADATA/);
});

function agentEvent(
  event: Record<string, unknown>,
  teamRole?: "lead" | "teammate",
): CoreSessionEvent {
  return {
    payload: {
      event,
      sessionId: "session",
      ...(teamRole ? { teamRole } : {}),
    },
    type: "agent_event",
  } as CoreSessionEvent;
}

function hookEvent(
  parentAgentId?: string,
  toolName = "read_files",
  hookEventName = "tool_call",
): CoreSessionEvent {
  return {
    payload: {
      hookEventName,
      parentAgentId,
      sessionId: "session",
      toolName,
    },
    type: "hook",
  } as CoreSessionEvent;
}

function toolEvent(
  toolName: string,
  toolCallId = `call-${toolName}`,
  phase = "started",
  sequenceNumber = 0,
): AgentEvent {
  return {
    payload: {
      phase,
      sequenceNumber,
      toolCall: { id: toolCallId, name: toolName },
      toolCallId,
      toolName,
    },
    sessionId: "session",
    type: "tool",
  };
}

function disabledToolPolicy() {
  return { enabled: false, autoApprove: false };
}

function fileAttachment(name: string, type: string) {
  return {
    content: Buffer.from("hello").toString("base64"),
    name,
    size: 5,
    type,
  };
}
