import type { AgentToolContext } from "@cline/sdk";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import { sha256 } from "./protocol.js";

export async function resolveClineContextEpoch(
  workspaceRoot: string,
  sessionId: string | undefined,
  context: AgentToolContext,
) {
  const explicit = context.metadata?.contextEpoch;
  if (typeof explicit === "string" && explicit)
    return sessionId ? scopedEpoch(explicit, sessionId, context) : explicit;
  if (sessionId && harnessFeatureEnabled("BLAME_CONTEXT_EPOCHS")) {
    const epoch = await new ConversationMemoryStore(
      workspaceRoot,
      sessionId,
    ).currentEpochId();
    return scopedEpoch(epoch, sessionId, context);
  }
  const firstMessageId = context.snapshot?.messages[0]?.id;
  if (firstMessageId)
    return `${context.conversationId ?? context.sessionId ?? "context"}:${firstMessageId}`;
  return context.runId ?? context.conversationId;
}

function scopedEpoch(
  epoch: string,
  sessionId: string,
  context: AgentToolContext,
) {
  const consumer = context.conversationId ?? context.sessionId;
  if (!consumer || consumer === sessionId) return epoch;
  return `${epoch}:consumer:${sha256(consumer).slice(0, 12)}`;
}
