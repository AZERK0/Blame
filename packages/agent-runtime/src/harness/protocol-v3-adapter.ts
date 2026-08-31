import { createHash } from "node:crypto";
import {
  InMemoryEvidenceAuthority,
  blockedResult,
  cancelledResult,
  completedResult,
  type CauseKind,
  type EvidenceAuthority,
  type HarnessResult,
  type Provenance as CoreProvenance,
  type RecoveryCondition,
} from "@blame/harness-core";
import {
  harnessSuccess,
  provenance as legacyProvenance,
  type HarnessToolResult,
  type RevisionVector,
} from "./protocol.js";

export type CanonicalResultContext = {
  executionId: string;
  toolCallId?: string;
  tool: string;
  producerVersion?: string;
  environmentRevisionId?: string;
  sourceRevisionId?: string;
};

export class CanonicalResultMapper {
  private readonly evidence: EvidenceAuthority;

  constructor(evidence: EvidenceAuthority = new InMemoryEvidenceAuthority()) {
    this.evidence = evidence;
  }

  map<T>(
    legacy: HarnessToolResult<T>,
    context: CanonicalResultContext,
  ): HarnessResult<T, unknown> {
    const provenance = canonicalProvenance(legacy, context);
    const evidence = this.evidenceReferences(legacy, provenance, context.tool);
    if (legacy.status === "error")
      return mapLegacyError(legacy, provenance, evidence, context);
    if (cancelledLegacyResult(legacy))
      return cancelledResult({
        data: legacy.data,
        cause: cancellationCause(legacy),
        evidence,
        provenance,
      });
    const effect = canonicalEffect(legacy, context.tool);
    if (effect === "none" && effectProven(effect, evidence, legacy.data))
      return completedResult({
        data: legacy.data,
        effect,
        evidence,
        provenance,
      });
    if (
      completedLegacyResult(legacy) &&
      effectProven(effect, evidence, legacy.data)
    )
      return completedResult({
        data: legacy.data,
        effect,
        evidence,
        provenance,
      });
    return mapLegacyBlock(legacy, provenance, evidence, effect, context);
  }

  private evidenceReferences<T>(
    legacy: HarnessToolResult<T>,
    provenance: CoreProvenance,
    tool: string,
  ) {
    const references = collectEvidenceReferences(legacy);
    if (references.length || legacy.status === "error") return references;
    if (!provenance.source_revision_id && !provenance.blob_hashes) return [];
    const reference = `evidence://runtime/${digest(stableJson([tool, legacy.subject_revision, legacy.data]))}`;
    this.evidence.record({
      evidence_ref: reference,
      kind: observationKind(tool),
      status: resultEvidenceStatus(legacy),
      scope: { paths: collectPaths(legacy.data), symbols: [] },
      provenance,
      freshness: { policy_version: "canonical-result/v3" },
    });
    return [reference];
  }
}

export function projectCanonicalResultV2<T>(
  result: HarnessResult<T, unknown>,
  startedAt = Date.now(),
): HarnessToolResult<T> {
  const revision = legacyRevision(result.provenance);
  const reason = projectionReason(result);
  const recommendation = projectionRecommendation(result);
  return harnessSuccess({
    data: result.data,
    revision,
    startedAt,
    provenance: [legacyProvenance("harness", revision)],
    outcome:
      result.outcome === "completed"
        ? canonicalCompletedOutcome(result.effect)
        : "blocked",
    reason,
    recommendation,
  });
}

function mapLegacyError<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "error" }>,
  provenance: CoreProvenance,
  evidence: string[],
  context: CanonicalResultContext,
) {
  return blockedResult({
    data: (legacy.error.recovery ?? {}) as T,
    satisfaction: "unsatisfied",
    issue: {
      kind: causeKind(legacy.error.code, legacy.error.message),
      code: legacy.error.code,
      message: legacy.error.message,
      details: legacy.error.recovery,
    },
    recovery: recoveryCondition(
      legacy.error.code,
      legacy.error.recovery,
      context,
    ),
    evidence,
    provenance,
  });
}

function mapLegacyBlock<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
  provenance: CoreProvenance,
  evidence: string[],
  effect: "none" | "observed" | "changed",
  context: CanonicalResultContext,
) {
  const data = recordValue(legacy.data);
  const partial =
    data.partial === true ||
    groupHasPartialEffect(data.groups) ||
    collectEvidenceReferences(legacy).some((value) =>
      value.startsWith("changeset://"),
    );
  const issue = legacyIssue(legacy, effect);
  return blockedResult({
    data: legacy.data,
    effect: partial ? "partial" : effect === "observed" ? "observed" : "none",
    satisfaction: partial ? "partially_satisfied" : "unsatisfied",
    issue,
    recovery: recoveryCondition(issue.code, data, context),
    evidence,
    provenance,
  });
}

function legacyIssue<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
  effect: string,
) {
  const data = recordValue(legacy.data);
  const code =
    effect === "none" && legacy.outcome === "skipped"
      ? "NO_EFFECT_NOT_PROVEN"
      : legacy.reason;
  return {
    kind: causeKind(code, stringValue(data.reason) ?? legacy.reason),
    code,
    message: stringValue(data.reason) ?? legacy.reason,
    details: legacy.data,
  };
}

function canonicalProvenance<T>(
  legacy: HarnessToolResult<T>,
  context: CanonicalResultContext,
): CoreProvenance {
  const revision =
    legacy.status === "success"
      ? legacy.subject_revision
      : legacy.subject_revision;
  return {
    source_revision_id:
      revision?.source_revision_id ??
      context.sourceRevisionId ??
      "src_unavailable",
    environment_revision_id:
      revision?.environment_spec_revision_id ??
      context.environmentRevisionId ??
      `env_${digest("unavailable").slice(0, 32)}`,
    execution_id: context.executionId,
    ...(context.toolCallId ? { tool_call_id: context.toolCallId } : {}),
    produced_at: new Date().toISOString(),
    producer_version: context.producerVersion ?? "agent-runtime/v4",
  };
}

function canonicalEffect<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
  tool: string,
) {
  const data = recordValue(legacy.data);
  if (legacy.outcome === "skipped") return "none" as const;
  if (mutationTools.has(tool) && mutationApplied(data))
    return "changed" as const;
  if (observationTools.has(tool) || taskObserved(data))
    return "observed" as const;
  return "none" as const;
}

function completedLegacyResult<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
) {
  if (["blocked", "skipped", "unavailable"].includes(legacy.outcome))
    return false;
  const data = recordValue(legacy.data);
  if (data.partial === true) return false;
  const status = stringValue(data.status);
  return ![
    "conflict",
    "failed",
    "infrastructure_error",
    "validation_failed",
  ].includes(status ?? "");
}

function cancelledLegacyResult<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
) {
  const status = stringValue(recordValue(legacy.data).status);
  return status === "cancelled" || legacy.reason === "TASK_CANCELLED";
}

function cancellationCause<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
) {
  return legacy.reason === "TASK_TIMED_OUT"
    ? ("timeout" as const)
    : ("user" as const);
}

function effectProven(
  effect: "none" | "observed" | "changed",
  evidence: string[],
  data: unknown,
) {
  if (effect === "changed")
    return evidence.some((reference) => reference.startsWith("changeset://"));
  if (effect === "observed") return evidence.length > 0;
  const value = recordValue(data);
  return (
    value.postcondition_satisfied === true ||
    [
      "already_available",
      "already_satisfied",
      "in_flight_reused",
      "retry_suppressed",
    ].includes(String(value.status ?? ""))
  );
}

function collectEvidenceReferences(value: unknown) {
  return unique(collectReferences(value, 0).filter(evidenceReference));
}

function collectReferences(value: unknown, depth: number): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value))
    return value.flatMap((entry) => collectReferences(entry, depth + 1));
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((entry) =>
    collectReferences(entry, depth + 1),
  );
}

function evidenceReference(value: string) {
  return /^(?:artifact|changeset|evidence|recovery|run):\/\//u.test(value);
}

function groupHasPartialEffect(value: unknown) {
  return (
    Array.isArray(value) &&
    value.some((group) => recordValue(group).effect === "partial")
  );
}

function collectPaths(value: unknown) {
  return unique(collectPathValues(value, 0));
}

function collectPathValues(value: unknown, depth: number): string[] {
  if (depth > 6 || !value || typeof value !== "object") return [];
  if (Array.isArray(value))
    return value.flatMap((entry) => collectPathValues(entry, depth + 1));
  const record = value as Record<string, unknown>;
  const direct = typeof record.path === "string" ? [record.path] : [];
  return [
    ...direct,
    ...Object.values(record).flatMap((entry) =>
      collectPathValues(entry, depth + 1),
    ),
  ];
}

function causeKind(code: string, message: string): CauseKind {
  if (/CANCEL|ABORT/u.test(code) || /cancel|abort/iu.test(message))
    return "cancelled";
  if (/INVALID_INPUT/u.test(code)) return "invalid_input";
  if (/STALE|CONFLICT|AMBIGUOUS|PRECONDITION|TARGET/u.test(code))
    return "invalid_input";
  if (/UNSUPPORTED/u.test(code)) return "harness_limitation";
  if (/POLICY|DENIED/u.test(code)) return "invalid_input";
  if (
    /EXECUTION|INFRASTRUCTURE|IO|NETWORK|PREVIEW_REFRESH|STORE|PACKAGE_MANAGER_UNAVAILABLE/u.test(
      code,
    ) ||
    /runtime|executor|network/iu.test(message)
  )
    return "infrastructure_failure";
  if (/UNAVAILABLE/u.test(code)) return "harness_limitation";
  if (/FAILED|VALIDATION|PARSE|TYPECHECK|TEST/u.test(code)) return "code_error";
  return "infrastructure_failure";
}

function recoveryCondition(
  code: string,
  recovery: unknown,
  context: CanonicalResultContext,
): RecoveryCondition {
  const declared = declaredRecoveryCondition(recovery);
  if (declared) return declared;
  if (/INVALID_INPUT/u.test(code)) return { condition: "new_input" };
  if (/STALE|CONFLICT|PRECONDITION/u.test(code))
    return { condition: "new_source_revision" };
  if (/POLICY|DENIED/u.test(code)) return { condition: "explicit_user_action" };
  if (/UNSUPPORTED/u.test(code)) return { condition: "never" };
  return {
    condition: "runtime_state_change",
    fingerprint: context.environmentRevisionId ?? digest(stableJson(recovery)),
  };
}

function declaredRecoveryCondition(value: unknown) {
  const record = recordValue(value);
  const nested = recordValue(record.recovery);
  const candidate = stringValue(nested.condition) ? nested : record;
  const condition = stringValue(candidate.condition);
  if (
    [
      "never",
      "new_input",
      "new_source_revision",
      "explicit_user_action",
    ].includes(condition ?? "")
  )
    return { condition } as RecoveryCondition;
  if (condition !== "runtime_state_change") return undefined;
  const fingerprint = stringValue(candidate.fingerprint);
  return fingerprint
    ? ({ condition, fingerprint } as RecoveryCondition)
    : undefined;
}

function mutationApplied(data: Record<string, unknown>) {
  return (
    data.changed === true ||
    ["applied", "committed"].includes(String(data.status ?? data.outcome ?? ""))
  );
}

function taskObserved(data: Record<string, unknown>) {
  return ["passed", "failed", "timed_out"].includes(String(data.status ?? ""));
}

function resultEvidenceStatus<T>(
  legacy: Extract<HarnessToolResult<T>, { status: "success" }>,
) {
  if (legacy.outcome === "unavailable") return "unavailable" as const;
  if (legacy.outcome === "blocked") return "failed" as const;
  const status = String(recordValue(legacy.data).status ?? "");
  return ["conflict", "failed", "validation_failed"].includes(status)
    ? ("failed" as const)
    : ("passed" as const);
}

function observationKind(tool: string) {
  return tool === "run_task" ? "run" : "observation";
}

function projectionReason<T>(result: HarnessResult<T, unknown>) {
  if (result.outcome === "blocked") return result.issue.code;
  if (result.outcome === "cancelled")
    return `CANCELLED_${result.cancellation_reason.toUpperCase()}`;
  return result.effect === "changed" ? "APPLIED" : "COMPLETED";
}

function projectionRecommendation<T>(result: HarnessResult<T, unknown>) {
  if (result.outcome === "completed") return "Continue with the task.";
  if (result.outcome === "cancelled") return "Wait for a new explicit request.";
  return `Retry only when ${result.recovery.condition} is satisfied.`;
}

function canonicalCompletedOutcome(effect: "none" | "observed" | "changed") {
  return effect === "changed" ? ("applied" as const) : ("completed" as const);
}

function legacyRevision(provenance: CoreProvenance): RevisionVector {
  return provenance.source_revision_id
    ? { source_revision_id: provenance.source_revision_id }
    : {};
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object")
    return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}

const mutationTools = new Set([
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
]);

const observationTools = new Set([
  "get_relation_context",
  "inspect_artifact",
  "inspect_code",
  "inspect_run",
  "outline_code",
  "recall_context",
  "review_change",
  "run_task",
  "search_code",
  "validate_change",
  "workspace_state",
]);
