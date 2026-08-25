import { z } from "zod";

export const memoryScopeSchema = z
  .object({
    type: z.enum([
      "global",
      "story",
      "file",
      "symbol",
      "feature",
      "platform",
      "viewport",
    ]),
    value: z.string().min(1).max(500).optional(),
  })
  .strict();

export const proposedMemoryFactSchema = z
  .object({
    kind: z.enum([
      "constraint",
      "decision",
      "rejection",
      "open_item",
      "preference",
    ]),
    text: z.string().min(1).max(1_000),
    scope: memoryScopeSchema,
    durability: z.enum(["turn", "story", "conversation"]),
    evidence_refs: z.array(z.string().min(1).max(500)).max(100).optional(),
  })
  .strict();

export const supersededMemoryFactSchema = z
  .object({
    fact_id: z.string().min(1).max(500),
    reason: z.string().min(1).max(1_000),
    evidence_refs: z.array(z.string().min(1).max(500)).max(100).optional(),
  })
  .strict();

export const continuityUpdateSchema = z
  .object({
    schema_version: z.literal("1.0"),
    intent: z
      .object({
        summary: z.string().min(1).max(1_000),
        scope: memoryScopeSchema.optional(),
      })
      .strict()
      .optional(),
    facts_added: z.array(proposedMemoryFactSchema).max(20),
    facts_superseded: z.array(supersededMemoryFactSchema).max(20),
    items_resolved: z.array(z.string().min(1).max(500)).max(20),
    change_receipt_refs: z.array(z.string().min(1).max(500)).max(100),
    next_focus: z.string().max(1_000).nullable().optional(),
  })
  .strict();

export const completeTurnInputSchema = z
  .object({
    answer: z
      .string()
      .min(1)
      .max(64 * 1_024),
    continuity_update: z.unknown().optional(),
  })
  .passthrough();

export type MemoryScope = z.infer<typeof memoryScopeSchema>;
export type ProposedMemoryFact = z.infer<typeof proposedMemoryFactSchema>;
export type SupersededMemoryFact = z.infer<typeof supersededMemoryFactSchema>;
export type ContinuityUpdate = z.infer<typeof continuityUpdateSchema>;
export type CompleteTurnInput = z.infer<typeof completeTurnInputSchema>;

export type StoredMemoryFact = {
  id: string;
  kind: ProposedMemoryFact["kind"];
  text: string;
  normalized_text: string;
  scope: MemoryScope;
  durability: ProposedMemoryFact["durability"];
  status: "active" | "superseded" | "resolved" | "rejected";
  authority: "user" | "runtime" | "agent";
  evidence_refs: string[];
  superseded_by?: string;
  created_at: string;
  updated_at: string;
};

export type MemoryEvidence =
  | {
      type: "user_message";
      ref: string;
      content: string;
      created_at: string;
    }
  | {
      type: "change_receipt";
      ref: string;
      files: string[];
      symbols: string[];
      status: string;
      created_at: string;
    }
  | {
      type: "run_receipt";
      ref: string;
      task_id: string;
      status: string;
      created_at: string;
    }
  | {
      type: "assistant_turn";
      ref: string;
      answer_summary?: string;
      created_at: string;
    }
  | {
      type: "runtime_event";
      ref: string;
      event:
        | "compaction"
        | "edit_conflict"
        | "epoch_changed"
        | "interruption"
        | "rollback"
        | "validation";
      status?: string;
      created_at: string;
    };

export type DeterministicFallbackMemory = {
  current_user_request_ref: string;
  applied_change_refs: string[];
  run_refs: string[];
  validation_status: string;
  interrupted: boolean;
};

export type ContinuityMergeMetrics = {
  continuity_update_present: boolean;
  continuity_update_valid: boolean;
  continuity_fallback_used: boolean;
  facts_added_count: number;
  facts_superseded_count: number;
  invalid_evidence_ref_count: number;
  memory_merge_conflict_count: number;
};

export function continuityFallbackMetrics(
  updatePresent: boolean,
): ContinuityMergeMetrics {
  return {
    continuity_update_present: updatePresent,
    continuity_update_valid: false,
    continuity_fallback_used: true,
    facts_added_count: 0,
    facts_superseded_count: 0,
    invalid_evidence_ref_count: 0,
    memory_merge_conflict_count: 0,
  };
}

export function parseContinuityUpdate(value: unknown) {
  if (value === undefined) return { valid: false as const };
  if (serializedBytes(value) > 16 * 1_024) return { valid: false as const };
  const parsed = continuityUpdateSchema.safeParse(value);
  if (parsed.success && continuityReferenceCount(parsed.data) > 100)
    return { valid: false as const };
  return parsed.success
    ? { valid: true as const, value: parsed.data }
    : { valid: false as const };
}

function continuityReferenceCount(update: ContinuityUpdate) {
  return (
    update.change_receipt_refs.length +
    update.items_resolved.length +
    update.facts_superseded.length +
    update.facts_added.reduce(
      (total, fact) => total + (fact.evidence_refs?.length ?? 0),
      0,
    ) +
    update.facts_superseded.reduce(
      (total, fact) => total + (fact.evidence_refs?.length ?? 0),
      0,
    )
  );
}

function serializedBytes(value: unknown) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
