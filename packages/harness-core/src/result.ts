import { createHash } from "node:crypto";

export const harnessProtocolVersion = "3" as const;

export type SourceRevisionId = string;
export type EnvironmentRevisionId = string;
export type ExecutionId = string;
export type ToolCallId = string;
export type ChangeReceiptRef = string;
export type RunReceiptRef = string;
export type ArtifactRef = string;
export type EvidenceRef = string;

export type RevisionPair = {
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
};

export type Provenance = RevisionPair & {
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
  | "code_error"
  | "infrastructure_failure"
  | "harness_limitation"
  | "invalid_input"
  | "external_failure"
  | "cancelled";

export type RecoveryCondition =
  | { condition: "never" }
  | { condition: "new_input" }
  | { condition: "new_source_revision" }
  | { condition: "runtime_state_change"; fingerprint: string }
  | { condition: "explicit_user_action" };

export type RetryPolicy = {
  allowed: boolean;
  responsible_actor: "runtime" | "agent" | "user";
  required_state_change: RecoveryCondition["condition"] | "not_applicable";
};

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
  transport_success: true;
  domain_outcome: "completed";
  outcome: "completed";
  effect: "none" | "observed" | "changed";
  satisfaction: "satisfied" | "not_applicable";
  cause: null;
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
  retry_policy: RetryPolicy;
  data: TData;
  evidence: EvidenceRef[];
  provenance: Provenance;
};

export type BlockedHarnessResult<TData, TIssueDetails> = {
  protocol_version: "3";
  transport_success: true;
  domain_outcome: "blocked";
  outcome: "blocked";
  effect: "none" | "observed" | "partial";
  satisfaction: "partially_satisfied" | "unsatisfied" | "unknown";
  cause: CauseKind;
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
  retry_policy: RetryPolicy;
  issue: HarnessIssue<TIssueDetails>;
  recovery: RecoveryCondition;
  data: TData;
  evidence: EvidenceRef[];
  provenance: Provenance;
};

export type CancelledHarnessResult<TData> = {
  protocol_version: "3";
  transport_success: true;
  domain_outcome: "cancelled";
  outcome: "cancelled";
  effect: "none" | "partial";
  satisfaction: "partially_satisfied" | "unknown";
  cause: "cancelled";
  cancellation_reason: "user" | "superseded" | "shutdown" | "timeout";
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
  retry_policy: RetryPolicy;
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
    transport_success: true,
    domain_outcome: "completed",
    outcome: "completed",
    effect: input.effect,
    satisfaction: input.satisfaction ?? "satisfied",
    cause: null,
    source_revision_id: input.provenance.source_revision_id,
    environment_revision_id: input.provenance.environment_revision_id,
    retry_policy: completedRetryPolicy,
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
  assertCodeDependentProvenance(input.provenance);
  return {
    protocol_version: harnessProtocolVersion,
    transport_success: true,
    domain_outcome: "blocked",
    outcome: "blocked",
    effect: input.effect ?? "none",
    satisfaction: input.satisfaction,
    cause: input.issue.kind,
    source_revision_id: input.provenance.source_revision_id,
    environment_revision_id: input.provenance.environment_revision_id,
    retry_policy: retryPolicy(input.issue.kind, input.recovery),
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
  cause: CancelledHarnessResult<TData>["cancellation_reason"];
  evidence?: EvidenceRef[];
  provenance: Provenance;
}): CancelledHarnessResult<TData> {
  assertCodeDependentProvenance(input.provenance);
  return {
    protocol_version: harnessProtocolVersion,
    transport_success: true,
    domain_outcome: "cancelled",
    outcome: "cancelled",
    effect: input.effect ?? "none",
    satisfaction: input.satisfaction ?? "unknown",
    cause: "cancelled",
    cancellation_reason: input.cause,
    source_revision_id: input.provenance.source_revision_id,
    environment_revision_id: input.provenance.environment_revision_id,
    retry_policy: cancelledRetryPolicy,
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
  if (!validEnvelope(value)) return false;
  if (value.outcome === "completed") return validCompleted(value);
  if (value.outcome === "blocked") return validBlocked(value);
  if (value.outcome === "cancelled") return validCancelled(value);
  return false;
}

export type RetryIdentity = {
  tool: string;
  normalized_input: unknown;
  source_revision_id: SourceRevisionId;
  environment_revision_id: EnvironmentRevisionId;
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
  if (!provenance.source_revision_id)
    throw new Error("SOURCE_REVISION_REQUIRED");
  if (!provenance.environment_revision_id)
    throw new Error("ENVIRONMENT_REVISION_REQUIRED");
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
    value.cause === null &&
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
    causeKinds.has(String(value.cause)) &&
    value.cause === recordValue(value.issue).kind &&
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
    String(value.cancellation_reason),
  );
  return (
    validEffect &&
    validSatisfaction &&
    value.cause === "cancelled" &&
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
  if (typeof value.source_revision_id !== "string") return false;
  if (typeof value.environment_revision_id !== "string") return false;
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
    typeof value.source_revision_id === "string" &&
    typeof value.environment_revision_id === "string"
  );
}

function validEnvelope(value: Record<string, unknown>) {
  const provenance = value.provenance as Provenance;
  return (
    value.transport_success === true &&
    value.domain_outcome === value.outcome &&
    value.source_revision_id === provenance.source_revision_id &&
    value.environment_revision_id === provenance.environment_revision_id &&
    validRetryPolicy(value.retry_policy)
  );
}

function validRetryPolicy(value: unknown) {
  if (!isRecord(value)) return false;
  return (
    typeof value.allowed === "boolean" &&
    ["runtime", "agent", "user"].includes(String(value.responsible_actor)) &&
    [...recoveryConditions, "not_applicable"].includes(
      String(value.required_state_change),
    )
  );
}

function retryPolicy(
  cause: CauseKind,
  recovery: RecoveryCondition,
): RetryPolicy {
  return {
    allowed: recovery.condition !== "never",
    responsible_actor: responsibleActor(cause, recovery),
    required_state_change: recovery.condition,
  };
}

function responsibleActor(cause: CauseKind, recovery: RecoveryCondition) {
  if (recovery.condition === "explicit_user_action") return "user" as const;
  if (cause === "code_error" || cause === "invalid_input")
    return "agent" as const;
  return "runtime" as const;
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function recoverySatisfied(prior: RetryRecord, current: RetryIdentity) {
  if (prior.recovery.condition === "never") return false;
  if (prior.recovery.condition === "explicit_user_action") return false;
  if (prior.recovery.condition === "new_input")
    return !sameInput(prior.identity, current);
  if (prior.recovery.condition === "new_source_revision")
    return prior.identity.source_revision_id !== current.source_revision_id;
  return (
    prior.identity.environment_revision_id !== current.environment_revision_id
  );
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
  "code_error",
  "external_failure",
  "harness_limitation",
  "infrastructure_failure",
  "cancelled",
]);

const recoveryConditions = new Set<string>([
  "never",
  "new_input",
  "new_source_revision",
  "runtime_state_change",
  "explicit_user_action",
]);

const completedRetryPolicy: RetryPolicy = {
  allowed: false,
  responsible_actor: "runtime",
  required_state_change: "not_applicable",
};

const cancelledRetryPolicy: RetryPolicy = {
  allowed: true,
  responsible_actor: "user",
  required_state_change: "explicit_user_action",
};
