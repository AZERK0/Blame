import {
  decodeHandle,
  harnessSuccess,
  sha256,
  type HarnessToolResult,
} from "./protocol.js";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";

type CycleDecision = HarnessToolResult<unknown> | undefined;

export class SemanticLoopDetector {
  private readonly cache = new Map<string, HarnessToolResult<unknown>>();
  private readonly cycleCounts = new Map<string, number>();
  private readonly history: string[] = [];
  private readonly resultFingerprints = new Set<string>();

  before(tool: SemanticWorkspaceToolName, input: unknown): CycleDecision {
    if (!isExploration(tool)) return undefined;
    const signature = semanticCallSignature(tool, input);
    this.history.push(signature);
    if (this.history.length > 12) this.history.shift();
    const cached = this.cache.get(signature);
    if (!cached) return undefined;
    const cycle = repeatedCycle(this.history);
    if (!cycle) return replayedResult(cached);
    const count = (this.cycleCounts.get(cycle) ?? 0) + 1;
    this.cycleCounts.set(cycle, count);
    if (count === 1) return replayedResult(cached);
    return cycleReceipt(cached, count > 2);
  }

  after<T>(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
  ) {
    if (realProgress(tool, result)) this.resetAfterProgress();
    if (!isExploration(tool)) return;
    const signature = semanticCallSignature(tool, input);
    this.cache.set(signature, result as HarnessToolResult<unknown>);
    const fingerprint = sha256(stableValue(result));
    if (!this.resultFingerprints.has(fingerprint)) this.cycleCounts.clear();
    this.resultFingerprints.add(fingerprint);
  }

  newUserRequest() {
    this.resetAfterProgress();
  }

  private resetAfterProgress() {
    this.cache.clear();
    this.history.length = 0;
    this.cycleCounts.clear();
    this.resultFingerprints.clear();
  }
}

export function semanticCallSignature(
  tool: SemanticWorkspaceToolName,
  input: unknown,
) {
  return `${tool}:${stableValue(normalizeValue(input))}`;
}

function repeatedCycle(history: string[]) {
  for (
    let size = 1;
    size <= Math.min(4, Math.floor(history.length / 2));
    size++
  ) {
    const recent = history.slice(-size);
    const previous = history.slice(-size * 2, -size);
    if (recent.every((value, index) => value === previous[index]))
      return recent.join("|");
  }
  return undefined;
}

function replayedResult(result: HarnessToolResult<unknown>) {
  if (result.status === "error") return result;
  return {
    ...result,
    diagnostics: [
      ...(result.diagnostics ?? []),
      {
        code: "RESULT_ALREADY_AVAILABLE",
        message:
          "The normalized request is unchanged; the prior result was reused without I/O.",
      },
    ],
  };
}

function cycleReceipt(result: HarnessToolResult<unknown>, stop: boolean) {
  return harnessSuccess({
    data: {
      status: stop ? "retry_suppressed" : "already_available",
      reason: "SEMANTIC_EXPLORATION_CYCLE",
      recommendation: stop
        ? "Stop exploring and edit, validate, or finish."
        : "Reuse the known result and take the next targeted action.",
    },
    revision: result.subject_revision ?? {},
    provenance: result.status === "success" ? result.provenance : [],
    startedAt: Date.now(),
    diagnostics: [
      {
        code: stop ? "SEMANTIC_RETRY_SUPPRESSED" : "RESULT_ALREADY_AVAILABLE",
        message: "The repeated exploration was suppressed without I/O.",
      },
    ],
  });
}

function realProgress<T>(
  tool: SemanticWorkspaceToolName,
  result: HarnessToolResult<T>,
) {
  if (result.status !== "success") return false;
  if (tool === "run_task")
    return ["failed", "passed"].includes(
      String(recordValue(result.data).status),
    );
  if (!isEdit(tool)) return false;
  return ["applied", "committed"].includes(
    String(recordValue(result.data).status ?? recordValue(result.data).outcome),
  );
}

function isExploration(tool: SemanticWorkspaceToolName) {
  return [
    "get_relation_context",
    "inspect_code",
    "outline_code",
    "search_code",
    "workspace_state",
  ].includes(tool);
}

function isEdit(tool: SemanticWorkspaceToolName) {
  return [
    "apply_change",
    "create_file",
    "delete_file",
    "edit_code",
    "edit_files",
    "edit_json",
    "edit_symbol",
    "move_file",
    "mutate_dependencies",
    "patch_file",
    "replace_file",
  ].includes(tool);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (!value || typeof value !== "object") return normalizeScalar(value);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !ignoredKey(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, field]) => [key, normalizeValue(field)]),
  );
}

function ignoredKey(key: string) {
  return /^(?:context_epoch|idempotency_key|limit|offset|page|revision|source_revision_id|tool_call_id|toolCallId)$/iu.test(
    key,
  );
}

function normalizeScalar(value: unknown) {
  if (typeof value !== "string") return value;
  if (/^(?:changeset|match):\/\//iu.test(value))
    return normalizedReference(value);
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function normalizedReference(value: string) {
  if (!value.startsWith("match://"))
    return `reference://changeset/${sha256(value)}`;
  const handle = decodeHandle(value, "match");
  if (!handle) return `reference://match/${sha256(value)}`;
  const { revision, ...identity } = handle;
  void revision;
  return `reference://match/${sha256(stableValue(identity))}`;
}

function stableValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
