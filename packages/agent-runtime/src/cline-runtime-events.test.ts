import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { CoreSessionEvent } from "@cline/sdk";
import type { AgentEvent } from "./types.js";

import {
  buildDevelopmentSystemPrompt,
  BlameAgentRuntime,
  developmentUserInput,
  duplicateEventSignature,
  initializationToolPolicies,
  nextSpawnAgentActiveCount,
  shouldDisplayClineSessionEvent,
  workspaceSessionIds,
} from "./cline-runtime.js";

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

test("limits initialization fallback tools to project reads and search", () => {
  const policies = initializationToolPolicies();

  assert.deepEqual(policies.read_files, { autoApprove: true });
  assert.deepEqual(policies.search_codebase, { autoApprove: true });
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

test("hides untagged sub-agent text while spawn agent is active", () => {
  assert.equal(
    shouldDisplayClineSessionEvent(
      agentEvent({ type: "content_start", contentType: "text", text: "hidden" }),
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
  assert.match(prompt, /## Task Classification/);
  assert.match(prompt, /<verification_matrix>/);
  assert.match(prompt, /<verification_cost_control>/);
  assert.match(prompt, /<coverage_disclosure>/);
  assert.match(prompt, /<external_action_guard>/);
  assert.match(prompt, /## Special Requests/);
  assert.match(prompt, /## Autonomy And Continuity/);
  assert.match(prompt, /## Progress Updates/);
  assert.match(prompt, /counter-checks/);
  assert.match(prompt, /## Blame Multi-Agent Mode/);
  assert.match(prompt, /## Coding Style: Standard Industrial Professional/);
  assert.match(prompt, /## Architecture: Match Codebase/);
  assert.match(prompt, /## Unit Tests: Professional TDD/);
  assert.match(prompt, /A passing test suite is not proof/);
  assert.match(prompt, /Do not run full workspace lint/);
  assert.match(prompt, /Blame Preview, container logs, DevTools console\/network checks/);
  assert.match(prompt, new RegExp(process.cwd().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
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
