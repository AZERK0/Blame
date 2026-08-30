import type { EvidencePlan } from "./evidence-planner.js";
import type { EditGroupReceipt } from "./transaction.js";
import type { SourceRevisionId } from "./result.js";

export type DeliveryStatus =
  | "satisfied"
  | "partially_satisfied"
  | "unsatisfied";

export type VerificationStatus =
  | "verified"
  | "partially_verified"
  | "unverified"
  | "failed"
  | "not_applicable";

export type CompletionReservation = {
  code: string;
  message: string;
  obligation_ids: string[];
};

export type CompletionDecision = {
  source_revision_id: SourceRevisionId;
  delivery: DeliveryStatus;
  verification: VerificationStatus;
  evidence_plan_id?: string;
  satisfied_obligations: string[];
  missing_obligations: string[];
  failed_obligations: string[];
  reservations: CompletionReservation[];
};

export type CompletionInput = {
  source_revision_id: SourceRevisionId;
  edit_groups: EditGroupReceipt[];
  evidence_plan?: EvidencePlan;
  non_mutating_intent_satisfied?: boolean;
};

export function deriveCompletionDecision(
  input: CompletionInput,
): CompletionDecision {
  const obligations = input.evidence_plan?.obligations ?? [];
  const satisfied = obligations.filter(
    (obligation) => obligation.status === "satisfied",
  );
  const failed = obligations.filter(
    (obligation) => obligation.status === "failed",
  );
  const missing = obligations.filter(
    (obligation) =>
      obligation.requirement === "required" &&
      ["missing", "unavailable"].includes(obligation.status),
  );
  return {
    source_revision_id: input.source_revision_id,
    delivery: deliveryStatus(input),
    verification: verificationStatus(
      obligations,
      satisfied.length,
      failed.length,
      missing.length,
    ),
    ...(input.evidence_plan
      ? { evidence_plan_id: input.evidence_plan.plan_id }
      : {}),
    satisfied_obligations: satisfied.map(
      (obligation) => obligation.obligation_id,
    ),
    missing_obligations: missing.map((obligation) => obligation.obligation_id),
    failed_obligations: failed.map((obligation) => obligation.obligation_id),
    reservations: reservations(missing, failed),
  };
}

export function completionLifecycleTerminal(decision: CompletionDecision) {
  if (decision.delivery === "unsatisfied" || decision.verification === "failed")
    return "failed" as const;
  return "succeeded" as const;
}

function deliveryStatus(input: CompletionInput): DeliveryStatus {
  if (input.non_mutating_intent_satisfied) return "satisfied";
  if (!input.edit_groups.length) return "unsatisfied";
  const satisfied = input.edit_groups.filter(
    (group) => group.satisfaction === "satisfied",
  ).length;
  if (satisfied === input.edit_groups.length) return "satisfied";
  return satisfied > 0 ? "partially_satisfied" : "unsatisfied";
}

function verificationStatus(
  obligations: EvidencePlan["obligations"],
  satisfied: number,
  failed: number,
  missing: number,
): VerificationStatus {
  const required = obligations.filter(
    (obligation) => obligation.requirement === "required",
  );
  if (!required.length) return "not_applicable";
  if (failed) return "failed";
  if (!missing) return "verified";
  return satisfied ? "partially_verified" : "unverified";
}

function reservations(
  missing: EvidencePlan["obligations"],
  failed: EvidencePlan["obligations"],
) {
  return [
    ...groupReservations(
      "EVIDENCE_MISSING",
      "Required evidence is missing or unavailable.",
      missing,
    ),
    ...groupReservations(
      "EVIDENCE_FAILED",
      "Required evidence failed.",
      failed,
    ),
  ];
}

function groupReservations(
  code: string,
  message: string,
  obligations: EvidencePlan["obligations"],
): CompletionReservation[] {
  if (!obligations.length) return [];
  return [
    {
      code,
      message,
      obligation_ids: obligations.map((obligation) => obligation.obligation_id),
    },
  ];
}
