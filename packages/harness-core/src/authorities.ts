import type {
  ExecutionLifecycle,
  ExecutionLifecycleSnapshot,
} from "./lifecycle.js";
import type { ChangeReceipt, SourceRevisionSnapshot } from "./ports.js";
import type {
  EvidenceRef,
  ExecutionId,
  Provenance,
  SourceRevisionId,
} from "./result.js";

export type ConversationFact = {
  fact_id: string;
  kind:
    | "user_message"
    | "current_objective"
    | "explicit_constraint"
    | "confirmed_decision"
    | "correction"
    | "sourced_continuity";
  value: string;
  source_ref: string;
  produced_at: string;
};

export interface ConversationAuthority {
  append(fact: ConversationFact): void;
  facts(): readonly ConversationFact[];
  currentRequest(): ConversationFact | undefined;
}

export class InMemoryConversationAuthority implements ConversationAuthority {
  private readonly values: ConversationFact[] = [];

  append(fact: ConversationFact) {
    this.values.push({ ...fact });
  }

  facts() {
    return this.values.map((fact) => ({ ...fact }));
  }

  currentRequest() {
    return [...this.values]
      .reverse()
      .find((fact) => fact.kind === "user_message");
  }
}

export interface SourceRevisionAuthority {
  current(): Promise<SourceRevisionSnapshot>;
  readBlob(
    path: string,
    sourceRevisionId: SourceRevisionId,
  ): Promise<Uint8Array>;
}

export interface EffectAuthority {
  record(receipt: ChangeReceipt): void;
  get(reference: string): ChangeReceipt | undefined;
  forRevision(sourceRevisionId: SourceRevisionId): readonly ChangeReceipt[];
}

export class InMemoryEffectAuthority implements EffectAuthority {
  private readonly receipts = new Map<string, ChangeReceipt>();

  record(receipt: ChangeReceipt) {
    if (!receipt.verified) throw new Error("UNVERIFIED_EFFECT_RECEIPT");
    this.receipts.set(receipt.receipt_ref, cloneReceipt(receipt));
  }

  get(reference: string) {
    const receipt = this.receipts.get(reference);
    return receipt ? cloneReceipt(receipt) : undefined;
  }

  forRevision(sourceRevisionId: SourceRevisionId) {
    return [...this.receipts.values()]
      .filter((receipt) => receipt.source_revision_after === sourceRevisionId)
      .map(cloneReceipt);
  }
}

export type EvidenceRecord = {
  evidence_ref: EvidenceRef;
  kind: string;
  status: "passed" | "failed" | "unavailable";
  scope: {
    paths: string[];
    symbols: string[];
  };
  provenance: Provenance;
  freshness: {
    policy_version: string;
    invalidated_at?: string;
    invalidation_reason?: string;
  };
};

export interface EvidenceAuthority {
  record(evidence: EvidenceRecord): void;
  get(reference: EvidenceRef): EvidenceRecord | undefined;
  freshForRevision(
    sourceRevisionId: SourceRevisionId,
  ): readonly EvidenceRecord[];
  invalidate(
    predicate: (evidence: EvidenceRecord) => boolean,
    reason: string,
  ): void;
}

export class InMemoryEvidenceAuthority implements EvidenceAuthority {
  private readonly records = new Map<EvidenceRef, EvidenceRecord>();

  record(evidence: EvidenceRecord) {
    if (
      !evidence.provenance.source_revision_id &&
      !evidence.provenance.blob_hashes
    )
      throw new Error("UNSCOPED_EVIDENCE");
    this.records.set(evidence.evidence_ref, cloneEvidence(evidence));
  }

  get(reference: EvidenceRef) {
    const evidence = this.records.get(reference);
    return evidence ? cloneEvidence(evidence) : undefined;
  }

  freshForRevision(sourceRevisionId: SourceRevisionId) {
    return [...this.records.values()]
      .filter(
        (evidence) =>
          evidence.provenance.source_revision_id === sourceRevisionId,
      )
      .filter((evidence) => !evidence.freshness.invalidated_at)
      .map(cloneEvidence);
  }

  invalidate(predicate: (evidence: EvidenceRecord) => boolean, reason: string) {
    for (const evidence of this.records.values()) {
      if (
        !evidence.freshness.invalidated_at &&
        predicate(cloneEvidence(evidence))
      )
        evidence.freshness = {
          ...evidence.freshness,
          invalidated_at: new Date().toISOString(),
          invalidation_reason: reason,
        };
    }
  }
}

export interface ExecutionAuthority {
  begin(lifecycle: ExecutionLifecycle): ExecutionLifecycleSnapshot;
  current(): ExecutionLifecycleSnapshot | undefined;
  lifecycle(executionId: ExecutionId): ExecutionLifecycle | undefined;
}

export class SingleExecutionAuthority implements ExecutionAuthority {
  private active?: ExecutionLifecycle;

  begin(lifecycle: ExecutionLifecycle) {
    const current = this.active?.snapshot();
    if (current && !terminalState(current.state))
      throw new Error("ACTIVE_EXECUTION_EXISTS");
    this.active = lifecycle;
    return lifecycle.snapshot();
  }

  current() {
    return this.active?.snapshot();
  }

  lifecycle(executionId: ExecutionId) {
    return this.active?.executionId === executionId ? this.active : undefined;
  }
}

function cloneReceipt(receipt: ChangeReceipt): ChangeReceipt {
  return { ...receipt, changed_paths: [...receipt.changed_paths] };
}

function cloneEvidence(evidence: EvidenceRecord): EvidenceRecord {
  return {
    ...evidence,
    scope: {
      paths: [...evidence.scope.paths],
      symbols: [...evidence.scope.symbols],
    },
    provenance: {
      ...evidence.provenance,
      ...(evidence.provenance.blob_hashes
        ? { blob_hashes: { ...evidence.provenance.blob_hashes } }
        : {}),
    },
    freshness: { ...evidence.freshness },
  };
}

function terminalState(state: string) {
  return ["succeeded", "failed", "cancelled"].includes(state);
}
