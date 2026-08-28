import {
  aggregateValidationStatus,
  aggregateValidator,
  type ContentValidation,
  type ValidationStatus,
} from "./content-validation.js";
import type { EditCodeOutcome } from "./edit-service.js";
import { decodeHandle } from "./protocol.js";
import type { ConflictCandidate } from "./semantic-reference-resolver.js";
import type { ChangeOperation, EditCodeOperation } from "./schemas.js";

export type FailedEditOperation = {
  candidates?: Array<ConflictCandidate | { line: number; excerpt: string }>;
  diagnostics?: string[];
  operation_index: number;
  path?: string;
  reason: string;
  status:
    | "conflict"
    | "denied"
    | "infrastructure_error"
    | "unsupported_operation"
    | "validation_failed";
};

export type SkippedEditOperation = {
  operation_index: number;
  path?: string;
  reason: "NO_CHANGE";
  status: "no_change";
};

export type EditGroup = {
  edits: EditCodeOperation[];
  indexes: number[];
  paths: Set<string>;
};

export type EditGroupResult = {
  group: EditGroup;
  result: EditCodeOutcome;
};

type AppliedOutcome = Extract<EditCodeOutcome, { status: "applied" }>;
type FailedOutcome = Exclude<
  EditCodeOutcome,
  { status: "applied" | "no_change" }
>;
type FailedGroupResult = { group: EditGroup; result: FailedOutcome };
type NoChangeGroupResult = {
  group: EditGroup;
  result: Extract<EditCodeOutcome, { status: "no_change" }>;
};

export function createEditGroups(edits: EditCodeOperation[]) {
  const groups: EditGroup[] = [];
  for (const [index, edit] of edits.entries()) {
    const paths = new Set(operationPaths(edit, index));
    const overlapping = groups.filter((group) =>
      intersects(group.paths, paths),
    );
    const merged = {
      edits: [edit],
      indexes: [index],
      paths,
    } satisfies EditGroup;
    for (const group of overlapping) mergeEditGroup(merged, group);
    for (const group of overlapping) groups.splice(groups.indexOf(group), 1);
    groups.push(merged);
  }
  return groups;
}

export function combineEditGroupResults(
  results: EditGroupResult[],
): EditCodeOutcome {
  const applied = results.flatMap(({ result }) =>
    result.status === "applied" ? [result] : [],
  );
  const failed = results.filter(isFailedGroupResult);
  const skipped = results
    .filter(isNoChangeGroupResult)
    .flatMap(skippedOperations);
  if (!applied.length) return combinedGroupFailure(results, failed);
  return combineAppliedOutcomes(
    applied,
    failedOperations(failed),
    skipped,
    failedValidations(failed),
  );
}

export function failedChangeOperationIndexes(
  operations: ChangeOperation[],
  rejectedPaths: Set<string>,
) {
  return operations.flatMap((operation, index) =>
    changeOperationPaths(operation).some((path) => rejectedPaths.has(path))
      ? [index]
      : [],
  );
}

function mergeEditGroup(target: EditGroup, source: EditGroup) {
  target.edits.unshift(...source.edits);
  target.indexes.unshift(...source.indexes);
  for (const path of source.paths) target.paths.add(path);
}

function intersects(left: Set<string>, right: Set<string>) {
  return [...left].some((path) => right.has(path));
}

function operationPaths(edit: EditCodeOperation, index: number) {
  if (edit.operation === "move_file") return [edit.from_path, edit.to_path];
  const paths = "path" in edit && edit.path ? [edit.path] : [];
  if (!("target" in edit)) return paths.length ? paths : [`operation:${index}`];
  const reference = semanticReference(edit.target);
  const handle = decodeHandle(reference.value, reference.scheme);
  return [...new Set([...paths, handle?.path ?? `operation:${index}`])];
}

function semanticReference(
  target: Extract<EditCodeOperation, { target: unknown }>["target"],
) {
  if ("symbol_ref" in target)
    return { scheme: "sym" as const, value: target.symbol_ref };
  if ("match_ref" in target)
    return { scheme: "match" as const, value: target.match_ref };
  return { scheme: "node" as const, value: target.node_ref };
}

function changeOperationPaths(operation: ChangeOperation) {
  if (operation.kind === "move_file")
    return [operation.from_path, operation.to_path];
  if ("path" in operation) return [operation.path];
  const path = semanticOperationPath(operation.target);
  return path ? [path] : [];
}

function semanticOperationPath(reference: string) {
  const scheme = reference.startsWith("sym://")
    ? "sym"
    : reference.startsWith("match://")
      ? "match"
      : "node";
  return decodeHandle(reference, scheme)?.path;
}

function failedOperations(failed: FailedGroupResult[]) {
  return failed.flatMap(({ group, result }) =>
    failedLocalIndexes(group, result).map((localIndex) =>
      failedEditOperation(
        group.indexes[localIndex]!,
        group.edits[localIndex]!,
        result,
      ),
    ),
  );
}

function failedLocalIndexes(group: EditGroup, result: FailedOutcome) {
  return result.failed_operation_indexes?.length
    ? result.failed_operation_indexes
    : group.indexes.map((_, index) => index);
}

function combinedGroupFailure(
  results: EditGroupResult[],
  failed: FailedGroupResult[],
) {
  const selected = failed[0];
  if (!selected) return lastGroupResult(results);
  const operations = failedOperations(failed);
  return {
    ...selected.result,
    failed_operation_indexes: operations.map(
      ({ operation_index }) => operation_index,
    ),
    failed_operations: operations,
  } as EditCodeOutcome;
}

function lastGroupResult(results: EditGroupResult[]) {
  const last = results.at(-1);
  if (!last) throw new Error("Edit batch produced no result.");
  return last.result;
}

function failedEditOperation(
  index: number,
  edit: EditCodeOperation,
  result: FailedOutcome,
): FailedEditOperation {
  const paths = operationPaths(edit, index).filter(
    (path) => !path.startsWith("operation:"),
  );
  const diagnostics = failureDiagnostics(result, paths);
  return {
    operation_index: index,
    ...(paths[0] ? { path: paths[0] } : {}),
    status: result.status,
    reason: editFailureReason(result),
    ...(diagnostics.length ? { diagnostics } : {}),
    ...(result.status === "conflict" ? { candidates: result.candidates } : {}),
  };
}

function failureDiagnostics(result: FailedOutcome, paths: string[]) {
  if (result.status !== "validation_failed") return [];
  const matching = result.validation.filter(({ path }) => paths.includes(path));
  const validations = matching.length ? matching : result.validation;
  return validations.flatMap(({ diagnostics }) => diagnostics).slice(0, 20);
}

function failedValidations(failed: FailedGroupResult[]) {
  return failed.flatMap(({ result }) =>
    result.status === "validation_failed" ? result.validation : [],
  );
}

function editFailureReason(result: FailedOutcome) {
  if (result.status === "validation_failed") return "VALIDATION_FAILED";
  return result.reason;
}

function isFailedGroupResult(
  value: EditGroupResult,
): value is FailedGroupResult {
  return (
    value.result.status !== "applied" && value.result.status !== "no_change"
  );
}

function isNoChangeGroupResult(
  value: EditGroupResult,
): value is NoChangeGroupResult {
  return value.result.status === "no_change";
}

function skippedOperations({ group }: NoChangeGroupResult) {
  return group.edits.map((edit, localIndex) => {
    const operationIndex = group.indexes[localIndex]!;
    const paths = operationPaths(edit, operationIndex).filter(
      (path) => !path.startsWith("operation:"),
    );
    return {
      operation_index: operationIndex,
      ...(paths[0] ? { path: paths[0] } : {}),
      reason: "NO_CHANGE" as const,
      status: "no_change" as const,
    };
  });
}

function combineAppliedOutcomes(
  outcomes: AppliedOutcome[],
  failed: FailedEditOperation[],
  skipped: SkippedEditOperation[],
  rejectedValidations: ContentValidation[],
): AppliedOutcome {
  const last = outcomes.at(-1)!;
  const validations = [
    ...outcomes.flatMap((outcome) => outcome.validation.files),
    ...rejectedValidations,
  ];
  const status = failed.length
    ? "failed"
    : aggregateValidationStatus(validations);
  return {
    ...last,
    ...combinedAppliedFields(outcomes),
    ...(failed.length ? { failed_operations: failed } : {}),
    ...(skipped.length ? { skipped_operations: skipped } : {}),
    ...(failed.length || skipped.length ? { partial: true } : {}),
    validation: combinedValidation(outcomes, validations, status),
  };
}

function combinedAppliedFields(outcomes: AppliedOutcome[]) {
  const strategies = uniqueStrings(
    outcomes.flatMap(
      (outcome) => outcome.semantic_rebase_strategy?.split("+") ?? [],
    ),
  );
  return {
    changed_files: outcomes.flatMap((outcome) => outcome.changed_files),
    changed_symbols: outcomes.flatMap((outcome) => outcome.changed_symbols),
    receipt_refs: outcomes.flatMap((outcome) => outcome.receipt_refs),
    file_receipts: outcomes.flatMap((outcome) => outcome.file_receipts),
    diff_artifact_refs: outcomes.flatMap(
      (outcome) => outcome.diff_artifact_refs,
    ),
    internal_retries: outcomes.reduce(
      (sum, outcome) => sum + outcome.internal_retries,
      0,
    ),
    new_symbol_refs: outcomes.flatMap((outcome) => outcome.new_symbol_refs),
    resolution: combinedResolution(outcomes),
    ...(strategies.length
      ? { semantic_rebase_strategy: strategies.join("+") }
      : {}),
  };
}

function combinedResolution(outcomes: AppliedOutcome[]) {
  return outcomes.some(
    (outcome) => outcome.resolution === "automatically_rebased",
  )
    ? ("automatically_rebased" as const)
    : ("exact" as const);
}

function combinedValidation(
  outcomes: AppliedOutcome[],
  files: ContentValidation[],
  status: ValidationStatus,
) {
  return {
    status,
    validator: aggregateValidator(files),
    files,
    parse: validationParseStatus(status),
    diagnostics: outcomes.flatMap((outcome) => outcome.validation.diagnostics),
  };
}

function validationParseStatus(status: ValidationStatus) {
  if (status === "passed") return "passed" as const;
  if (status === "validator_unavailable") return "pending" as const;
  if (status === "not_supported") return "not_supported" as const;
  return "skipped" as const;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}
