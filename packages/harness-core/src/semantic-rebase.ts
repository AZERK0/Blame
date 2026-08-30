import type { SourceRevisionId } from "./result.js";

export const semanticRebasePolicyVersion = "semantic-rebase/v1" as const;

export type SemanticEvidenceClass =
  | "exact_digest"
  | "exact_original_position"
  | "unique_symbol_fingerprint"
  | "unique_qualified_name_and_signature"
  | "unique_body_and_ancestry_fingerprint"
  | "unique_lexical_match"
  | "neighbor_and_ordinal_only"
  | "bounded_similarity_only";

export type SemanticResolutionReceipt = {
  policy: "semantic-rebase/v1";
  resolution: "exact" | "automatically_rebased" | "refused";
  evidence_classes: SemanticEvidenceClass[];
  score: number;
  runner_up_score?: number;
  runner_up_margin?: number;
  original_path: string;
  resolved_path?: string;
  requested_source_revision_id: SourceRevisionId;
  current_source_revision_id: SourceRevisionId;
};

export type SemanticCandidate = {
  candidate_id: string;
  path: string;
  language_id: string;
  syntax_kind: string;
  score: number;
  evidence_classes: SemanticEvidenceClass[];
};

export type SemanticResolutionInput = {
  mode: "read" | "write";
  operation:
    | "inspect"
    | "replace_symbol"
    | "replace_body"
    | "replace_signature"
    | "insert_sibling"
    | "delete_symbol"
    | "rename_public";
  requested_source_revision_id: SourceRevisionId;
  current_source_revision_id: SourceRevisionId;
  original_path: string;
  language_id: string;
  syntax_kind: string;
  candidates: SemanticCandidate[];
  cas_generated: boolean;
  post_validation_available: boolean;
};

export type SemanticResolutionDecision = {
  candidate?: SemanticCandidate;
  receipt: SemanticResolutionReceipt;
  reason_code?: string;
};

export type SemanticRebasePolicy = {
  version: "semantic-rebase/v1";
  minimum_read_score: number;
  minimum_write_score: number;
  plausibility_score: number;
  minimum_runner_up_margin: number;
  maximum_candidates: number;
};

export const semanticRebasePolicy: SemanticRebasePolicy = {
  version: semanticRebasePolicyVersion,
  minimum_read_score: 0.58,
  minimum_write_score: 0.58,
  plausibility_score: 0.48,
  minimum_runner_up_margin: 0.1,
  maximum_candidates: 200,
};

export function resolveSemanticCandidate(
  input: SemanticResolutionInput,
  policy: SemanticRebasePolicy = semanticRebasePolicy,
): SemanticResolutionDecision {
  const candidates = input.candidates
    .slice(0, policy.maximum_candidates)
    .filter((candidate) => compatibleCandidate(candidate, input))
    .sort(candidateOrder);
  const selected = candidates[0];
  const runnerUp = candidates[1];
  const refusal = refusalReason(input, selected, runnerUp, policy);
  if (refusal) return refusedDecision(input, selected, runnerUp, refusal);
  return acceptedDecision(input, selected!, runnerUp);
}

function refusalReason(
  input: SemanticResolutionInput,
  selected: SemanticCandidate | undefined,
  runnerUp: SemanticCandidate | undefined,
  policy: SemanticRebasePolicy,
) {
  if (!selected) return "TARGET_GONE";
  const threshold =
    input.mode === "write"
      ? policy.minimum_write_score
      : policy.minimum_read_score;
  if (selected.score < threshold) return "INSUFFICIENT_EVIDENCE";
  if (
    runnerUp &&
    runnerUp.score >= policy.plausibility_score &&
    selected.score - runnerUp.score < policy.minimum_runner_up_margin
  )
    return "AMBIGUOUS_TARGET";
  if (input.mode === "read")
    return readEvidenceAccepted(selected) ? undefined : "INSUFFICIENT_EVIDENCE";
  return writeRefusalReason(input, selected);
}

function writeRefusalReason(
  input: SemanticResolutionInput,
  selected: SemanticCandidate,
) {
  if (!input.cas_generated) return "CAS_PRECONDITION_REQUIRED";
  if (!input.post_validation_available) return "POST_VALIDATION_UNAVAILABLE";
  if (!writeEvidenceAccepted(selected)) return "WRITE_EVIDENCE_TOO_WEAK";
  if (sensitiveOperation(input.operation) && !strongWriteEvidence(selected))
    return "SENSITIVE_WRITE_EVIDENCE_TOO_WEAK";
  return undefined;
}

function compatibleCandidate(
  candidate: SemanticCandidate,
  input: SemanticResolutionInput,
) {
  return (
    candidate.language_id === input.language_id &&
    candidate.syntax_kind === input.syntax_kind
  );
}

function readEvidenceAccepted(candidate: SemanticCandidate) {
  return candidate.evidence_classes.some(
    (evidence) => evidence !== "bounded_similarity_only",
  );
}

function writeEvidenceAccepted(candidate: SemanticCandidate) {
  return candidate.evidence_classes.some((evidence) =>
    writeEvidenceClasses.has(evidence),
  );
}

function strongWriteEvidence(candidate: SemanticCandidate) {
  return candidate.evidence_classes.some((evidence) =>
    strongWriteEvidenceClasses.has(evidence),
  );
}

function sensitiveOperation(operation: SemanticResolutionInput["operation"]) {
  return ["replace_signature", "delete_symbol", "rename_public"].includes(
    operation,
  );
}

function acceptedDecision(
  input: SemanticResolutionInput,
  selected: SemanticCandidate,
  runnerUp: SemanticCandidate | undefined,
): SemanticResolutionDecision {
  const exact =
    selected.path === input.original_path &&
    selected.evidence_classes.some((evidence) =>
      exactEvidenceClasses.has(evidence),
    );
  return {
    candidate: cloneCandidate(selected),
    receipt: receipt(
      input,
      selected,
      runnerUp,
      exact ? "exact" : "automatically_rebased",
    ),
  };
}

function refusedDecision(
  input: SemanticResolutionInput,
  selected: SemanticCandidate | undefined,
  runnerUp: SemanticCandidate | undefined,
  reasonCode: string,
): SemanticResolutionDecision {
  return {
    receipt: receipt(input, selected, runnerUp, "refused"),
    reason_code: reasonCode,
  };
}

function receipt(
  input: SemanticResolutionInput,
  selected: SemanticCandidate | undefined,
  runnerUp: SemanticCandidate | undefined,
  resolution: SemanticResolutionReceipt["resolution"],
): SemanticResolutionReceipt {
  const margin =
    selected && runnerUp ? selected.score - runnerUp.score : undefined;
  return {
    policy: semanticRebasePolicyVersion,
    resolution,
    evidence_classes: [...(selected?.evidence_classes ?? [])],
    score: rounded(selected?.score ?? 0),
    ...(runnerUp ? { runner_up_score: rounded(runnerUp.score) } : {}),
    ...(margin !== undefined ? { runner_up_margin: rounded(margin) } : {}),
    original_path: input.original_path,
    ...(selected ? { resolved_path: selected.path } : {}),
    requested_source_revision_id: input.requested_source_revision_id,
    current_source_revision_id: input.current_source_revision_id,
  };
}

function candidateOrder(left: SemanticCandidate, right: SemanticCandidate) {
  return (
    right.score - left.score ||
    left.path.localeCompare(right.path) ||
    left.candidate_id.localeCompare(right.candidate_id)
  );
}

function cloneCandidate(candidate: SemanticCandidate): SemanticCandidate {
  return { ...candidate, evidence_classes: [...candidate.evidence_classes] };
}

function rounded(value: number) {
  return Number(value.toFixed(3));
}

const exactEvidenceClasses = new Set<SemanticEvidenceClass>([
  "exact_digest",
  "exact_original_position",
]);
const writeEvidenceClasses = new Set<SemanticEvidenceClass>([
  "exact_digest",
  "exact_original_position",
  "unique_symbol_fingerprint",
  "unique_qualified_name_and_signature",
  "unique_body_and_ancestry_fingerprint",
  "unique_lexical_match",
]);
const strongWriteEvidenceClasses = new Set<SemanticEvidenceClass>([
  "exact_digest",
  "exact_original_position",
  "unique_symbol_fingerprint",
  "unique_qualified_name_and_signature",
]);
