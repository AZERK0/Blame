import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { completeTurnInputSchema } from "./continuity-schema.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";

export const completeTurnToolName = "complete_turn";

export type CompleteTurnNotification = {
  answer: string;
  metrics: Awaited<
    ReturnType<ConversationMemoryStore["completeTurn"]>
  >["metrics"];
};

export function createCompleteTurnTool(options: {
  conversationId: string;
  workspaceRoot: string;
  onComplete?(notification: CompleteTurnNotification): void;
}): AgentTool {
  const memory = new ConversationMemoryStore(
    options.workspaceRoot,
    options.conversationId,
  );
  return createTool<unknown, unknown>({
    name: completeTurnToolName,
    description:
      "Finish the current user turn exactly once. Put only the user-visible response in answer. continuity_update must contain schema_version 1.0 and only new intent, facts_added, facts_superseded, items_resolved, change_receipt_refs, and optional next_focus from this turn. Never restate unchanged memory or technical output.",
    inputSchema: completeTurnJsonSchema,
    lifecycle: { completesRun: true },
    retryable: false,
    maxRetries: 0,
    execute: (raw: unknown, context: AgentToolContext) =>
      executeCompleteTurn(raw, context, memory, options.onComplete),
  });
}

async function executeCompleteTurn(
  raw: unknown,
  context: AgentToolContext,
  memory: ConversationMemoryStore,
  onComplete: ((notification: CompleteTurnNotification) => void) | undefined,
) {
  const parsed = completeTurnInputSchema.safeParse(raw);
  if (!parsed.success) return invalidCompletionResult();
  const readiness = await memory.completionReadiness();
  if (!readiness.completionAllowed)
    return {
      output: {
        status: "blocked",
        completionAllowed: false,
        reason: readiness.reason,
      },
      isError: true,
    };
  const source = raw as Record<string, unknown>;
  const result = await memory.completeTurn({
    answer: parsed.data.answer,
    continuityUpdate: harnessFeatureEnabled("BLAME_CONTINUITY_DELTA")
      ? source.continuity_update
      : undefined,
    completionRef: completionReference(context),
  });
  onComplete?.(result);
  return { output: { status: "completed", continuity: result.metrics } };
}

function invalidCompletionResult() {
  return {
    output: { status: "invalid", reason: "answer is required" },
    isError: true,
  };
}

function completionReference(context: AgentToolContext) {
  return context.toolCallId
    ? `assistant-turn://${context.toolCallId}`
    : `assistant-turn://${context.runId ?? context.iteration}`;
}

const completeTurnJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["answer"],
  properties: {
    answer: { type: "string", minLength: 1, maxLength: 65_536 },
    continuity_update: continuityUpdateJsonSchema(),
  },
};

function continuityUpdateJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "facts_added",
      "facts_superseded",
      "items_resolved",
      "change_receipt_refs",
    ],
    properties: {
      schema_version: { const: "1.0" },
      intent: intentJsonSchema(),
      facts_added: proposedFactsJsonSchema(),
      facts_superseded: supersededFactsJsonSchema(),
      items_resolved: referenceArray(20),
      change_receipt_refs: referenceArray(100),
      next_focus: { type: ["string", "null"], maxLength: 1_000 },
    },
  };
}

function intentJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: boundedString(1_000),
      scope: memoryScopeJsonSchema(),
    },
  };
}

function proposedFactsJsonSchema() {
  return {
    type: "array",
    maxItems: 20,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "text", "scope", "durability"],
      properties: {
        kind: {
          enum: [
            "constraint",
            "decision",
            "rejection",
            "open_item",
            "preference",
          ],
        },
        text: boundedString(1_000),
        scope: memoryScopeJsonSchema(),
        durability: { enum: ["turn", "story", "conversation"] },
        evidence_refs: referenceArray(100),
      },
    },
  };
}

function supersededFactsJsonSchema() {
  return {
    type: "array",
    maxItems: 20,
    items: {
      type: "object",
      additionalProperties: false,
      required: ["fact_id", "reason"],
      properties: {
        fact_id: boundedString(500),
        reason: boundedString(1_000),
        evidence_refs: referenceArray(100),
      },
    },
  };
}

function memoryScopeJsonSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["type"],
    properties: {
      type: {
        enum: [
          "global",
          "story",
          "file",
          "symbol",
          "feature",
          "platform",
          "viewport",
        ],
      },
      value: boundedString(500),
    },
  };
}

function boundedString(maxLength: number) {
  return { type: "string", minLength: 1, maxLength };
}

function referenceArray(maxItems: number) {
  return { type: "array", maxItems, items: boundedString(500) };
}
