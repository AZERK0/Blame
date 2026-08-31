import { isHarnessResult } from "@blame/harness-core";
import { harnessSuccess, sha256 } from "./protocol.js";
import {
  semanticWorkspaceReadToolNames,
  type SemanticWorkspaceToolName,
} from "./semantic-executor.js";
import { semanticCallSignature } from "./semantic-loop-detector.js";
import { WorkspaceFiles } from "./workspace-files.js";

type ReadDecision = {
  key?: string;
  result?: ReturnType<typeof harnessSuccess>;
};

export class ClineReadMemory {
  private readonly active = new Set<string>();
  private readonly completed = new Set<string>();

  constructor(
    private readonly files: WorkspaceFiles,
    private readonly initialTaskBriefing?: string,
  ) {}

  async before(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    contextEpoch?: string,
  ): Promise<ReadDecision> {
    const briefing = await this.briefingReceipt(tool, input);
    if (briefing) return { result: briefing };
    if (!semanticWorkspaceReadToolNames.some((name) => name === tool))
      return {};
    const snapshot = await this.files.snapshot().catch(() => undefined);
    if (!snapshot) return {};
    const key = readKey(
      snapshot.revision.source_revision_id,
      contextEpoch,
      tool,
      input,
    );
    if (this.active.has(key))
      return { result: inFlightReceipt(snapshot.revision) };
    if (this.completed.has(key))
      return { result: completedReceipt(snapshot.revision, key) };
    this.active.add(key);
    return { key };
  }

  complete(key: string | undefined, result: unknown) {
    if (!key || !reusableResult(result)) return;
    this.completed.add(key);
    while (this.completed.size > 500)
      this.completed.delete(this.completed.values().next().value!);
  }

  release(key?: string) {
    if (key) this.active.delete(key);
  }

  private async briefingReceipt(
    tool: SemanticWorkspaceToolName,
    input: unknown,
  ) {
    if (
      tool !== "workspace_state" ||
      !this.initialTaskBriefing ||
      !defaultStateInput(input)
    )
      return undefined;
    const sourceRevision = briefingRevision(this.initialTaskBriefing);
    const snapshot = await this.files.snapshot().catch(() => undefined);
    if (
      !sourceRevision ||
      snapshot?.revision.source_revision_id !== sourceRevision
    )
      return undefined;
    return briefingReceipt(snapshot.revision, sourceRevision);
  }
}

function readKey(
  sourceRevision: string,
  contextEpoch: string | undefined,
  tool: SemanticWorkspaceToolName,
  input: unknown,
) {
  return [
    sourceRevision,
    contextEpoch ?? "unscoped-context",
    semanticCallSignature(tool, input),
  ].join(":");
}

function reusableResult(result: unknown) {
  if (isHarnessResult(result)) return result.outcome === "completed";
  const value = recordValue(result);
  return value.status === "success" && value.outcome !== "unavailable";
}

function inFlightReceipt(revision: Revision) {
  return harnessSuccess({
    startedAt: Date.now(),
    revision,
    provenance: [],
    outcome: "skipped",
    reason: "READ_IN_FLIGHT",
    recommendation: "Reuse the active read receipt.",
    coverage: { scope: "unknown", truncated: true },
    data: {
      status: "in_flight_reused",
      duplicate_broad_read_suppressed: true,
      content_coverage: "none",
      shared_iteration_budget_suppressed: false,
    },
  });
}

function completedReceipt(revision: Revision, key: string) {
  return harnessSuccess({
    startedAt: Date.now(),
    revision,
    provenance: [],
    outcome: "skipped",
    reason: "READ_ALREADY_IN_ACTIVE_CONTEXT",
    recommendation: "Continue from the existing result without rereading.",
    data: {
      status: "already_available",
      read_receipt_ref: `semantic-read://${sha256(key)}`,
      content_in_active_context: true,
      source_unchanged: true,
    },
  });
}

function briefingReceipt(revision: Revision, sourceRevision: string) {
  return harnessSuccess({
    startedAt: Date.now(),
    revision,
    provenance: [],
    outcome: "skipped",
    reason: "WORKSPACE_STATE_IN_TASK_BRIEFING",
    recommendation: "Use task_briefing and continue with the first target.",
    data: {
      status: "already_available",
      available_in: "task_briefing",
      source_revision_id: sourceRevision,
    },
  });
}

function defaultStateInput(value: unknown) {
  const input = recordValue(value);
  return !input.cursor && !input.include && !input.page_size;
}

function briefingRevision(value: string) {
  try {
    const data = recordValue(JSON.parse(value));
    return String(recordValue(data.source_revision).source_revision_id ?? "");
  } catch {
    return undefined;
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type Revision = {
  source_revision_id: string;
  environment_revision_id?: string;
};
