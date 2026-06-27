import assert from "node:assert/strict";
import test from "node:test";

import type { CoreSessionEvent } from "@cline/sdk";
import type { AgentEvent } from "./types.js";

import {
  duplicateEventSignature,
  nextSpawnAgentActiveCount,
  shouldDisplayClineSessionEvent,
} from "./cline-runtime.js";

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
