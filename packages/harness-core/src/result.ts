import { createHash } from "node:crypto";

export const harnessProtocolVersion = "3" as const;

export type SourceRevisionId = string;
export type ExecutionId = string;
export type ToolCallId = string;
export type ChangeReceiptRef = string;
export type RunReceiptRef = string;
export type ArtifactRef = string;
export type EvidenceRef = string;

export type Provenance = {
  source_revision_id?: SourceRevisionId;
  blob_hashes?: Record<string, string>;
  execution_id: ExecutionId;
  tool_call_id?: ToolCallId;
  produced_at: string;
  producer_version: string;
};

export type EffectStatus = "none" | "observed" | "changed" | "partial";

export type SatisfactionStatus =
  | "satisfied"
  | "partially_satisfied"
  | "unsatisfied"
  | "unknown"
  | "not_applicable";

export type CauseKind =
  | "invalid_input"
  | "conflict"
  | "code_failure"
  | "capability_unavailable"
  | "infrastructure"
  | "policy"
  | "internal";

export type RecoveryCondition =
  | { condition: "never" }
  | { condition: "new_input" }
  | { condition: "new_source_revision" }
  | { condition: "runtime_state_change"; fingerprint: string }
  | { condition: "explicit_user_action" };

export type HarnessIssue<TDetails> = {
  kind: CauseKind;
  code: string;
  message: string;
  details: TDetails;
};

export type HarnessResult<TData, TIssueDetails = never> =
  | CompletedHarnessResult<TData>
  | BlockedHarnessResult<TData, TIssueDetails>
  | CancelledHarnessResult<TData>;

export type CompletedHarnessResult<TData> = {
  protocol_version: "3";
  outcome: "completed";
  effect: "none" | "observed" | "changed";
  satisfaction: "satisfied" | "not_applicable";
  data: TData;
  evidence: EvidenceRef[];
  provenance: Provenance;
};

export type BlockedHarnessResult<TData, TIssueDetails> = {
  protocol_version: "3";
  outcome: "blocked";
  effect: "none" | "observed" | "partial";
  satisfaction: "partially_satisfied" | "unsatisfied" | "unknown";
  issue: HarnessIssue<TIssueDetails>;
  recovery: RecoveryCondition;
  data: TData;
  evidence: EvidenceRef[];
  provenance: Provenance;
};

export type CancelledHarnessResult<TData> = {
  protocol_version: "3";
  outcome: "cancelled";
  effect: "none" | "partial";
  satisfaction: "partially_satisfied" | "unknown";
  cause: "user" | "superseded" | "shutdown" | "timeout";
  data: TData;
  evidence: EvidenceRef[];
  provenance: Provenance;
};

export function completedResult<TData>(input: {
  data: TData;
  effect: CompletedHarnessResult<TData>["effect"];
  satisfaction?: CompletedHarnessResult<TData>["satisfaction"];
  evidence?: EvidenceRef[];
  provenance: Provenance;
}): CompletedHarnessResult<TData> {
  assertCodeDependentProvenance(input.provenance);
  assertCompletedEvidence(input.effect, input.evidence ?? []);
  return {
    protocol_version: harnessProtocolVersion,
    outcome: "completed",
    effect: input.effect,
    satisfaction: input.satisfaction ?? "satisfied",
    data: input.data,
    evidence: [...(input.evidence ?? [])],
    provenance: cloneProvenance(input.provenance),
  };
}

export function blockedResult<TData, TIssueDetails>(input: {
  data: TData;
  effect?: BlockedHarnessResult<TData, TIssueDetails>["effect"];
  satisfaction: BlockedHarnessResult<TData, TIssueDetails>["satisfaction"];
  issue: HarnessIssue<TIssueDetails>;
  recovery: RecoveryCondition;
  evidence?: EvidenceRef[];
  provenance: Provenance;
}): BlockedHarnessResult<TData, TIssueDetails> {
  return {
    protocol_version: harnessProtocolVersion,
    outcome: "blocked",
    effect: input.effect ?? "none",
    satisfaction: input.satisfaction,
    issue: { ...input.issue },
    recovery: { ...input.recovery },
    data: input.data,
    evidence: [...(input.evidence ?? [])],
    provenance: cloneProvenance(input.provenance),
  };
}

export function cancelledResult<TData>(input: {
  data: TData;
  effect?: CancelledHarnessResult<TData>["effect"];
  satisfaction?: CancelledHarnessResult<TData>["satisfaction"];
  cause: CancelledHarnessResult<TData>["cause"];
  evidence?: EvidenceRef[];
  provenance: Provenance;
}): CancelledHarnessResult<TData> {
  return {
    protocol_version: harnessProtocolVersion,
    outcome: "cancelled",
    effect: input.effect ?? "none",
    satisfaction: input.satisfaction ?? "unknown",
    cause: input.cause,
    data: input.data,
    evidence: [...(input.evidence ?? [])],
    provenance: cloneProvenance(input.provenance),
  };
}

export function isHarnessResult(
  value: unknown,
): value is HarnessResult<unknown, unknown> {
  if (!isRecord(value) || value.protocol_version !== "3") return false;
  if (!isProvenance(value.provenance) || !Array.isArray(value.evidence))
    return false;
  if (value.outcome === "completed") return validCompleted(value);
  if (value.outcome === "blocked") return validBlocked(value);
  if (value.outcome === "cancelled") return validCancelled(value);
  return false;
}

export type RetryIdentity = {
  tool: string;
  normalized_input: unknown;
  source_revision_id?: SourceRevisionId;
  environment_fingerprint: string;
  policy_version: string;
};

type RetryRecord = {
  identity: RetryIdentity;
  recovery: RecoveryCondition;
};

export class RetryLedger {
  private readonly records = new Map<string, RetryRecord>();

  remember(identity: RetryIdentity, recovery: RecoveryCondition) {
    this.records.set(retryKey(identity), { identity, recovery });
  }

  canAttempt(identity: RetryIdentity) {
    const prior = this.records.get(retryKey(identity));
    return !prior || recoverySatisfied(prior, identity);
  }

  recovery(identity: RetryIdentity) {
    return this.records.get(retryKey(identity))?.recovery;
  }

  clear(identity: RetryIdentity) {
    this.records.delete(retryKey(identity));
  }

  reset() {
    this.records.clear();
  }
}

function assertCompletedEvidence(
  effect: EffectStatus,
  evidence: EvidenceRef[],
) {
  if (evidence.length) return;
  throw new Error(
    effect === "none" ? "NO_EFFECT_NOT_PROVEN" : "EFFECT_NOT_PROVEN",
  );
}

function assertCodeDependentProvenance(provenance: Provenance) {
  if (provenance.source_revision_id || provenance.blob_hashes) return;
  throw new Error("CODE_DEPENDENT_PROVENANCE_REQUIRED");
}

function cloneProvenance(value: Provenance): Provenance {
  return {
    ...value,
    ...(value.blob_hashes ? { blob_hashes: { ...value.blob_hashes } } : {}),
  };
}

function validCompleted(value: Record<string, unknown>) {
  const validEffect = ["none", "observed", "changed"].includes(
    String(value.effect),
  );
  const validSatisfaction = ["satisfied", "not_applicable"].includes(
    String(value.satisfaction),
  );
  return (
    validEffect &&
    validSatisfaction &&
    Object.hasOwn(value, "data") &&
    validEvidence(value.evidence, true) &&
    codeScopedProvenance(value.provenance)
  );
}

function validBlocked(value: Record<string, unknown>) {
  const validEffect = ["none", "observed", "partial"].includes(
    String(value.effect),
  );
  const validSatisfaction = [
    "partially_satisfied",
    "unsatisfied",
    "unknown",
  ].includes(String(value.satisfaction));
  return (
    validEffect &&
    validSatisfaction &&
    validIssue(value.issue) &&
    validRecovery(value.recovery) &&
    validEvidence(value.evidence, false)
  );
}

function validCancelled(value: Record<string, unknown>) {
  const validEffect = ["none", "partial"].includes(String(value.effect));
  const validSatisfaction = ["partially_satisfied", "unknown"].includes(
    String(value.satisfaction),
  );
  const validCause = ["user", "superseded", "shutdown", "timeout"].includes(
    String(value.cause),
  );
  return (
    validEffect &&
    validSatisfaction &&
    validCause &&
    validEvidence(value.evidence, false)
  );
}

function isProvenance(value: unknown): value is Provenance {
  if (!isRecord(value)) return false;
  const baseValid =
    typeof value.execution_id === "string" &&
    typeof value.produced_at === "string" &&
    typeof value.producer_version === "string";
  if (!baseValid) return false;
  if (
    value.source_revision_id !== undefined &&
    typeof value.source_revision_id !== "string"
  )
    return false;
  if (value.blob_hashes === undefined) return true;
  return (
    isRecord(value.blob_hashes) &&
    Object.values(value.blob_hashes).every((hash) => typeof hash === "string")
  );
}

function validEvidence(value: unknown, required: boolean) {
  return (
    Array.isArray(value) &&
    (!required || value.length > 0) &&
    value.every(
      (reference) => typeof reference === "string" && reference.length > 0,
    )
  );
}

function validIssue(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    causeKinds.has(String(value.kind)) &&
    typeof value.code === "string" &&
    typeof value.message === "string" &&
    Object.hasOwn(value, "details")
  );
}

function validRecovery(value: unknown) {
  if (!isRecord(value) || !recoveryConditions.has(String(value.condition)))
    return false;
  return (
    value.condition !== "runtime_state_change" ||
    (typeof value.fingerprint === "string" && value.fingerprint.length > 0)
  );
}

function codeScopedProvenance(value: unknown) {
  return (
    isRecord(value) &&
    (typeof value.source_revision_id === "string" ||
      isRecord(value.blob_hashes))
  );
}

function recoverySatisfied(prior: RetryRecord, current: RetryIdentity) {
  if (prior.recovery.condition === "never") return false;
  if (prior.recovery.condition === "explicit_user_action") return false;
  if (prior.recovery.condition === "new_input")
    return !sameInput(prior.identity, current);
  if (prior.recovery.condition === "new_source_revision")
    return prior.identity.source_revision_id !== current.source_revision_id;
  return prior.recovery.fingerprint !== current.environment_fingerprint;
}

function sameInput(left: RetryIdentity, right: RetryIdentity) {
  return (
    stableJson(left.normalized_input) === stableJson(right.normalized_input)
  );
}

function retryKey(identity: RetryIdentity) {
  return digest(stableJson(identity));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) return JSON.stringify(value) ?? "null";
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`);
  return `{${entries.join(",")}}`;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

const causeKinds = new Set<string>([
  "invalid_input",
  "conflict",
  "code_failure",
  "capability_unavailable",
  "infrastructure",
  "policy",
  "internal",
]);

const recoveryConditions = new Set<string>([
  "never",
  "new_input",
  "new_source_revision",
  "runtime_state_change",
  "explicit_user_action",
]);
