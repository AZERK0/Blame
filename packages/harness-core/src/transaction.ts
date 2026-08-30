import { createHash } from "node:crypto";
import type {
  PreparedChange,
  SourceRevisionSnapshot,
  WorkspacePort,
} from "./ports.js";
import {
  blockedResult,
  cancelledResult,
  completedResult,
  type ChangeReceiptRef,
  type HarnessResult,
  type Provenance,
  type SourceRevisionId,
} from "./result.js";

export type TransactionalEditOperation = {
  operation_index: number;
  operation: unknown;
  effective_paths: string[];
  consumes_operation_indexes?: number[];
};

export type EditDependencyGroup = {
  group_id: string;
  operation_indexes: number[];
  effective_paths: string[];
  operations: TransactionalEditOperation[];
};

export type EditGroupReceipt = {
  group_id: string;
  operation_indexes: number[];
  effective_paths: string[];
  outcome: "applied" | "already_satisfied" | "blocked" | "cancelled";
  issue_code?: string;
  effect: "none" | "changed" | "partial";
  satisfaction: "satisfied" | "unsatisfied" | "unknown";
  receipt_ref?: ChangeReceiptRef;
  source_revision_before: SourceRevisionId;
  source_revision_after: SourceRevisionId;
  recovery_artifact_ref?: string;
};

export type EditBatchPayload = {
  atomicity: "path_dependency_groups";
  preparation_source_revision: SourceRevisionId;
  groups: EditGroupReceipt[];
  committed_revisions: SourceRevisionId[];
};

export type TransactionIssue = {
  group_ids: string[];
  issue_codes: string[];
};

export type TransactionEngineInput = {
  operations: TransactionalEditOperation[];
  execution: { provenance: Provenance; signal?: AbortSignal };
};

type PreparedGroup = {
  group: EditDependencyGroup;
  preparation?: PreparedChange;
  issue?: string;
};

export class TransactionEngine {
  private readonly workspace: WorkspacePort;

  constructor(workspace: WorkspacePort) {
    this.workspace = workspace;
  }

  async execute(
    input: TransactionEngineInput,
  ): Promise<HarnessResult<EditBatchPayload, TransactionIssue>> {
    const snapshot = await this.workspace.observeRevision();
    const groups = buildPathDependencyGroups(input.operations);
    const prepared = await Promise.all(
      groups.map((group) => this.prepare(group, snapshot)),
    );
    return this.commit(prepared, snapshot, input.execution);
  }

  private async prepare(
    group: EditDependencyGroup,
    snapshot: SourceRevisionSnapshot,
  ): Promise<PreparedGroup> {
    try {
      const preparation = await this.workspace.prepareChange({
        source_revision_id: snapshot.source_revision_id,
        operation_indexes: [...group.operation_indexes],
        operations: group.operations.map((operation) => operation.operation),
      });
      assertPreparedGroup(group, preparation, snapshot.source_revision_id);
      return { group, preparation };
    } catch (error) {
      return { group, issue: errorCode(error, "PREPARATION_FAILED") };
    }
  }

  private async commit(
    prepared: PreparedGroup[],
    snapshot: SourceRevisionSnapshot,
    execution: TransactionEngineInput["execution"],
  ) {
    const receipts: EditGroupReceipt[] = [];
    let currentRevision = snapshot.source_revision_id;
    for (const group of prepared) {
      const receipt = await this.commitGroup(
        group,
        currentRevision,
        execution.signal,
      );
      receipts.push(receipt);
      currentRevision = receipt.source_revision_after;
      if (execution.signal?.aborted) break;
    }
    return aggregateEditReceipts(
      receipts,
      prepared,
      snapshot.source_revision_id,
      execution,
    );
  }

  private async commitGroup(
    prepared: PreparedGroup,
    currentRevision: SourceRevisionId,
    signal?: AbortSignal,
  ): Promise<EditGroupReceipt> {
    if (signal?.aborted) return cancelledGroup(prepared.group, currentRevision);
    if (prepared.issue || !prepared.preparation)
      return blockedGroup(
        prepared.group,
        currentRevision,
        prepared.issue ?? "PREPARATION_FAILED",
      );
    if (prepared.preparation.postcondition_satisfied)
      return satisfiedGroup(prepared.group, currentRevision);
    return this.applyPrepared(prepared, currentRevision);
  }

  private async applyPrepared(
    prepared: PreparedGroup,
    currentRevision: SourceRevisionId,
  ): Promise<EditGroupReceipt> {
    try {
      const receipt = await this.workspace.commitChange({
        prepared_change: prepared.preparation!,
        expected_source_revision_id: currentRevision,
      });
      if (!receipt.verified) throw new Error("POST_COMMIT_NOT_VERIFIED");
      return appliedGroup(prepared.group, receipt);
    } catch (error) {
      return failedCommitGroup(prepared.group, currentRevision, error);
    }
  }
}

export function buildPathDependencyGroups(
  operations: TransactionalEditOperation[],
) {
  const parent = operations.map((_, index) => index);
  const byOperationIndex = new Map(
    operations.map((operation, index) => [operation.operation_index, index]),
  );
  connectSharedPaths(operations, parent);
  connectConsumers(operations, parent, byOperationIndex);
  return materializeGroups(operations, parent);
}

export function aggregateEditGroupReceipts(input: {
  groups: EditGroupReceipt[];
  preparation_source_revision: SourceRevisionId;
  provenance: Provenance;
  cancelled?: boolean;
}): HarnessResult<EditBatchPayload, TransactionIssue> {
  return aggregateEditReceipts(
    input.groups,
    input.groups.map((receipt) => ({ group: receiptGroup(receipt) })),
    input.preparation_source_revision,
    {
      provenance: input.provenance,
      ...(input.cancelled ? { signal: abortedSignal() } : {}),
    },
  );
}

function aggregateEditReceipts(
  receipts: EditGroupReceipt[],
  expected: PreparedGroup[],
  preparationRevision: SourceRevisionId,
  execution: TransactionEngineInput["execution"],
): HarnessResult<EditBatchPayload, TransactionIssue> {
  const completeReceipts = appendUnprocessedReceipts(
    receipts,
    expected,
    preparationRevision,
    execution.signal,
  );
  const data = batchPayload(completeReceipts, preparationRevision);
  const evidence = completeReceipts.flatMap(groupEvidence);
  if (execution.signal?.aborted)
    return cancelledBatch(data, evidence, execution.provenance);
  const blocked = completeReceipts.filter(
    (receipt) => receipt.outcome === "blocked",
  );
  if (blocked.length)
    return blockedBatch(data, blocked, evidence, execution.provenance);
  const changed = completeReceipts.some(
    (receipt) => receipt.effect === "changed",
  );
  return completedResult({
    data,
    effect: changed ? "changed" : "none",
    evidence,
    provenance: execution.provenance,
  });
}

function blockedBatch(
  data: EditBatchPayload,
  blocked: EditGroupReceipt[],
  evidence: string[],
  provenance: Provenance,
) {
  const satisfied = data.groups.some(
    (receipt) => receipt.satisfaction === "satisfied",
  );
  return blockedResult({
    data,
    effect: data.groups.some((receipt) => receipt.effect !== "none")
      ? "partial"
      : "none",
    satisfaction: satisfied ? "partially_satisfied" : "unsatisfied",
    issue: {
      kind: "conflict",
      code: "EDIT_GROUP_BLOCKED",
      message: "One or more path dependency groups were not committed.",
      details: {
        group_ids: blocked.map((receipt) => receipt.group_id),
        issue_codes: blocked.map((receipt) => receipt.issue_code ?? "UNKNOWN"),
      },
    },
    recovery: { condition: "new_source_revision" },
    evidence,
    provenance,
  });
}

function cancelledBatch(
  data: EditBatchPayload,
  evidence: string[],
  provenance: Provenance,
) {
  const committed = data.groups.some(
    (receipt) => receipt.outcome === "applied",
  );
  return cancelledResult({
    data,
    effect: committed ? "partial" : "none",
    satisfaction: committed ? "partially_satisfied" : "unknown",
    cause: "user",
    evidence,
    provenance,
  });
}

function connectSharedPaths(
  operations: TransactionalEditOperation[],
  parent: number[],
) {
  const pathOwners = new Map<string, number>();
  for (const [index, operation] of operations.entries()) {
    for (const path of new Set(operation.effective_paths)) {
      const owner = pathOwners.get(path);
      if (owner === undefined) pathOwners.set(path, index);
      else union(parent, owner, index);
    }
  }
}

function connectConsumers(
  operations: TransactionalEditOperation[],
  parent: number[],
  byOperationIndex: Map<number, number>,
) {
  for (const [index, operation] of operations.entries()) {
    for (const dependency of operation.consumes_operation_indexes ?? []) {
      const dependencyIndex = byOperationIndex.get(dependency);
      if (dependencyIndex !== undefined) union(parent, dependencyIndex, index);
    }
  }
}

function materializeGroups(
  operations: TransactionalEditOperation[],
  parent: number[],
) {
  const grouped = new Map<number, TransactionalEditOperation[]>();
  for (const [index, operation] of operations.entries()) {
    const root = find(parent, index);
    grouped.set(root, [...(grouped.get(root) ?? []), operation]);
  }
  return [...grouped.values()].map(materializeGroup).sort(groupOrder);
}

function materializeGroup(
  operations: TransactionalEditOperation[],
): EditDependencyGroup {
  const ordered = [...operations].sort(
    (left, right) => left.operation_index - right.operation_index,
  );
  const operationIndexes = ordered.map(
    (operation) => operation.operation_index,
  );
  const paths = [
    ...new Set(ordered.flatMap((operation) => operation.effective_paths)),
  ].sort();
  return {
    group_id: `edit-group://${digest(JSON.stringify([operationIndexes, paths])).slice(0, 24)}`,
    operation_indexes: operationIndexes,
    effective_paths: paths,
    operations: ordered,
  };
}

function assertPreparedGroup(
  group: EditDependencyGroup,
  prepared: PreparedChange,
  revision: SourceRevisionId,
) {
  if (prepared.source_revision_id !== revision)
    throw new Error("PREPARATION_REVISION_MISMATCH");
  if (
    JSON.stringify(prepared.operation_indexes) !==
    JSON.stringify(group.operation_indexes)
  )
    throw new Error("PREPARATION_OPERATION_MISMATCH");
}

function appliedGroup(
  group: EditDependencyGroup,
  receipt: Awaited<ReturnType<WorkspacePort["commitChange"]>>,
): EditGroupReceipt {
  if (receipt.rollback === "incomplete")
    return {
      ...groupReceiptIdentity(group),
      outcome: "blocked",
      issue_code: "ROLLBACK_INCOMPLETE",
      effect: "partial",
      satisfaction: "unknown",
      source_revision_before: receipt.source_revision_before,
      source_revision_after: receipt.source_revision_after,
      receipt_ref: receipt.receipt_ref,
      ...(receipt.recovery_artifact_ref
        ? { recovery_artifact_ref: receipt.recovery_artifact_ref }
        : {}),
    };
  return {
    ...groupReceiptIdentity(group),
    outcome: "applied",
    effect: "changed",
    satisfaction: "satisfied",
    receipt_ref: receipt.receipt_ref,
    source_revision_before: receipt.source_revision_before,
    source_revision_after: receipt.source_revision_after,
  };
}

function failedCommitGroup(
  group: EditDependencyGroup,
  revision: SourceRevisionId,
  error: unknown,
) {
  const recovery = recoveryDetails(error);
  return {
    ...groupReceiptIdentity(group),
    outcome: "blocked" as const,
    issue_code: errorCode(error, "COMMIT_FAILED"),
    effect: recovery.incomplete ? ("partial" as const) : ("none" as const),
    satisfaction: recovery.incomplete
      ? ("unknown" as const)
      : ("unsatisfied" as const),
    source_revision_before: revision,
    source_revision_after: recovery.sourceRevisionAfter ?? revision,
    ...(recovery.artifactRef
      ? { recovery_artifact_ref: recovery.artifactRef }
      : {}),
  };
}

function satisfiedGroup(
  group: EditDependencyGroup,
  revision: SourceRevisionId,
): EditGroupReceipt {
  return {
    ...groupReceiptIdentity(group),
    outcome: "already_satisfied",
    effect: "none",
    satisfaction: "satisfied",
    source_revision_before: revision,
    source_revision_after: revision,
  };
}

function blockedGroup(
  group: EditDependencyGroup,
  revision: SourceRevisionId,
  issueCode: string,
): EditGroupReceipt {
  return {
    ...groupReceiptIdentity(group),
    outcome: "blocked",
    issue_code: issueCode,
    effect: "none",
    satisfaction: "unsatisfied",
    source_revision_before: revision,
    source_revision_after: revision,
  };
}

function cancelledGroup(
  group: EditDependencyGroup,
  revision: SourceRevisionId,
): EditGroupReceipt {
  return {
    ...groupReceiptIdentity(group),
    outcome: "cancelled",
    effect: "none",
    satisfaction: "unknown",
    source_revision_before: revision,
    source_revision_after: revision,
  };
}

function appendUnprocessedReceipts(
  receipts: EditGroupReceipt[],
  expected: PreparedGroup[],
  revision: SourceRevisionId,
  signal?: AbortSignal,
) {
  const processed = new Set(receipts.map((receipt) => receipt.group_id));
  const missing = expected
    .filter(({ group }) => !processed.has(group.group_id))
    .map(({ group }) =>
      signal?.aborted
        ? cancelledGroup(group, revision)
        : blockedGroup(group, revision, "NOT_PROCESSED"),
    );
  return [...receipts, ...missing];
}

function batchPayload(
  groups: EditGroupReceipt[],
  revision: SourceRevisionId,
): EditBatchPayload {
  return {
    atomicity: "path_dependency_groups",
    preparation_source_revision: revision,
    groups,
    committed_revisions: groups
      .filter((group) => group.outcome === "applied")
      .map((group) => group.source_revision_after),
  };
}

function groupEvidence(receipt: EditGroupReceipt) {
  if (receipt.receipt_ref) return [receipt.receipt_ref];
  if (receipt.outcome === "already_satisfied")
    return [
      `evidence://postcondition/${digest(stableGroupReceipt(receipt)).slice(0, 32)}`,
    ];
  return [];
}

function stableGroupReceipt(receipt: EditGroupReceipt) {
  return JSON.stringify([
    receipt.group_id,
    receipt.operation_indexes,
    receipt.effective_paths,
    receipt.source_revision_after,
  ]);
}

function groupReceiptIdentity(group: EditDependencyGroup) {
  return {
    group_id: group.group_id,
    operation_indexes: [...group.operation_indexes],
    effective_paths: [...group.effective_paths],
  };
}

function receiptGroup(receipt: EditGroupReceipt): EditDependencyGroup {
  return {
    group_id: receipt.group_id,
    operation_indexes: [...receipt.operation_indexes],
    effective_paths: [...receipt.effective_paths],
    operations: [],
  };
}

function recoveryDetails(error: unknown) {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    incomplete: value.rollback === "incomplete",
    artifactRef:
      typeof value.recovery_artifact_ref === "string"
        ? value.recovery_artifact_ref
        : undefined,
    sourceRevisionAfter:
      typeof value.source_revision_after === "string"
        ? value.source_revision_after
        : undefined,
  };
}

function errorCode(error: unknown, fallback: string) {
  if (!error || typeof error !== "object") return fallback;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code ? code : fallback;
}

function find(parent: number[], value: number): number {
  if (parent[value] === value) return value;
  parent[value] = find(parent, parent[value]!);
  return parent[value]!;
}

function union(parent: number[], left: number, right: number) {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
}

function groupOrder(left: EditDependencyGroup, right: EditDependencyGroup) {
  return left.operation_indexes[0]! - right.operation_indexes[0]!;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function abortedSignal() {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}
