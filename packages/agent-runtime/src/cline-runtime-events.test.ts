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
  });
  const hyphenatedIterationLimit = resultFailureMessage({
    finishReason: "max-iterations",
  });
  const generic = resultFailureMessage({ finishReason: "mistake_limit" });

  assert.equal(detailed, "Provider unavailable");
  assert.equal(
    iterationLimit,
    "Agent session ended with status max_iterations.",
  );
  assert.equal(
    hyphenatedIterationLimit,
    "Agent session ended with status max-iterations.",
  );
  assert.equal(generic, "Agent session ended with status mistake_limit.");
  assert.doesNotMatch(`${detailed} ${generic}`, /cline/i);
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
    "tool:session:read_files",
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

test("renders the Blame development system prompt without Cline placeholders", async () => {
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
  assert.match(prompt, /<security_protocol>/);
  assert.match(prompt, /<judgment_defaults>/);
  assert.match(prompt, /<planning_gate>/);
  assert.match(prompt, /<frontend_protocol>/);
  assert.match(
    prompt,
    /MUST invoke the `skills` tool with `skill: "impeccable"`/,
  );
  assert.match(prompt, /Consulting `frontend_design` does not replace/);
  assert.match(prompt, /do not make the frontend changes/);
  assert.match(prompt, /## Task Classification/);
  assert.match(prompt, /<verification_matrix>/);
  assert.match(prompt, /<verification_cost_control>/);
  assert.match(prompt, /<coverage_disclosure>/);
  assert.match(prompt, /<external_action_guard>/);
  assert.match(prompt, /## Special Requests/);
  assert.match(prompt, /## Autonomy And Continuity/);
  assert.match(prompt, /## Progress Updates/);
  assert.match(prompt, /counter-checks/);
  assert.match(prompt, /## Blame Specialist Consultations/);
  assert.match(prompt, /consult_specialist/);
  assert.match(prompt, /private instructions internally/);
  assert.doesNotMatch(prompt, /<system_prompt/);
  assert.doesNotMatch(prompt, /## Specialist knowledge/);
  assert.doesNotMatch(prompt, /Jobs To Be Done/);
  assert.doesNotMatch(prompt, /Gestalt grouping/);
  assert.ok(prompt.length < 30_000);
  assert.match(prompt, /## Coding Style: Standard Industrial Professional/);
  assert.match(prompt, /## Architecture: Match Codebase/);
  assert.match(prompt, /## Unit Tests: Professional TDD/);
  assert.match(prompt, /A passing test suite is not proof/);
  assert.match(prompt, /Do not run full workspace lint/);
  assert.match(
    prompt,
    /Blame Preview, container logs, DevTools console\/network checks/,
  );
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

function toolEvent(toolName: string): AgentEvent {
  return {
    payload: { status: "started", toolName },
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
