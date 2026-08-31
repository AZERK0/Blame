import {
  type SemanticResolutionInput,
  type SemanticResolutionReceipt,
} from "@blame/harness-core";
import {
  materializeSymbol,
  parseCode,
  symbolEditRange,
  syntaxBoundaryRange,
} from "./code-intelligence.js";
import {
  ChangeService,
  IncompleteRollbackError,
  NoChangesProposed,
} from "./change-service.js";
import { stableJson } from "./change-store.js";
import {
  aggregateValidationStatus,
  aggregateValidator,
  validateContent,
  type ContentValidation,
  type ValidationStatus,
} from "./content-validation.js";
import {
  combineEditGroupResults,
  createEditGroups,
  editBatchContract,
  failedChangeOperationIndexes,
  type EditGroupResult,
  type EditBatchContract,
  type EditGroup,
  type FailedEditOperation,
  type SkippedEditOperation,
} from "./edit-batch.js";
import { lineChanges } from "./edit-content.js";
import { editCssDeclaration } from "./css-declaration-editor.js";
import { EditConflictCircuit } from "./edit-conflict-circuit.js";
import { editJsonContent } from "./json-editor.js";
import { importTextEdit } from "./import-editor.js";
import { languageCapability } from "./language-capabilities.js";
import {
  PatchRecoveryConflict,
  recoverPatch,
  UnsupportedPatchOperation,
} from "./patch-recovery.js";
import { EditReceiptStore } from "./edit-receipt-store.js";
import { decodeHandle, sha256, type HandlePayload } from "./protocol.js";
import {
  SemanticReferenceResolver,
  SemanticResolutionConflict,
  type ConflictCandidate,
  type ResolvedSemanticReference,
} from "./semantic-reference-resolver.js";
import {
  editCodeInputSchema,
  normalizeEditCodeInput,
  type ChangeOperation,
  type EditCodeInput,
  type EditCodeOperation,
  type NormalizedEditCodeInput,
  type StoredChangeProposal,
} from "./schemas.js";
import { semanticSymbolDiff } from "./semantic-workspace-support.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";

type EditExecutionContext = {
  sessionId?: string;
  toolCallId?: string;
};

type ResolvedTarget = {
  handle: HandlePayload;
  path: string;
  resolution: "exact" | "automatically_rebased";
  receipt: SemanticResolutionReceipt;
  strategy: string;
  target: string;
};

type EditCodeOutcomePayload =
  | {
      changed_files: Array<{
        additions: number;
        deletions: number;
        new_hash: string | null;
        old_hash: string | null;
        path: string;
      }>;
      changed_symbols: Array<{
        added: unknown[];
        modified: unknown[];
        path: string;
        removed: unknown[];
      }>;
      diff_artifact_ref: string;
      diff_artifact_refs: string[];
      failed_operations?: FailedEditOperation[];
      skipped_operations?: SkippedEditOperation[];
      file_receipts: Array<{
        diff_artifact_ref: string;
        paths: string[];
        receipt_ref: string;
      }>;
      internal_retries: number;
      changed: true;
      outcome: "applied";
      receipt_ref: string;
      receipt_refs: string[];
      resolution: "exact" | "automatically_rebased";
      semantic_rebase_strategy?: string;
      semantic_resolution_receipts: SemanticResolutionReceipt[];
      source_revision: string;
      status: "applied";
      new_symbol_refs: string[];
      validation: {
        status: ValidationStatus;
        validator: string | null;
        files: ContentValidation[];
        parse: "passed" | "failed" | "unsupported";
        diagnostics: StoredChangeProposal["diagnostics"];
      };
      partial?: boolean;
    }
  | {
      candidates: Array<ConflictCandidate | { line: number; excerpt: string }>;
      current_context?: string;
      failed_hunk?: string;
      reason: string;
      recommended_strategy?: string;
      recommendedTool?: string;
      retrySuppressed?: boolean;
      failed_operation_indexes?: number[];
      failed_operations?: FailedEditOperation[];
      outcome: "conflict";
      status: "conflict";
    }
  | {
      diagnostics: StoredChangeProposal["diagnostics"];
      validation: ContentValidation[];
      proposed_diff_artifact_ref: string;
      outcome: "validation_failed";
      status: "validation_failed";
      failed_operation_indexes?: number[];
      failed_operations?: FailedEditOperation[];
    }
  | {
      outcome: "unsupported_operation";
      reason: string;
      reasonCode: string;
      recommendedTool: string;
      status: "unsupported_operation";
      failed_operation_indexes?: number[];
      failed_operations?: FailedEditOperation[];
    }
  | {
      outcome: "infrastructure_error";
      reason: string;
      status: "infrastructure_error";
      failed_operation_indexes?: number[];
      failed_operations?: FailedEditOperation[];
    }
  | {
      outcome: "conflict";
      reason: string;
      recovery_artifact_ref: string;
      source_revision: string;
      status: "recovery_required";
      failed_operation_indexes?: number[];
      failed_operations?: FailedEditOperation[];
    }
  | {
      changed: false;
      outcome: "no_change";
      postcondition_evidence_ref: string;
      postcondition_satisfied: true;
      source_revision: string;
      status: "no_change";
    }
  | {
      outcome: "unsupported_operation";
      reason: string;
      status: "denied";
      failed_operation_indexes?: number[];
      failed_operations?: FailedEditOperation[];
    };

export type EditCodeOutcome = EditCodeOutcomePayload &
  Partial<EditBatchContract>;

type AppliedOutcome = Extract<EditCodeOutcome, { status: "applied" }>;
type ChangedDetail = {
  file: AppliedOutcome["changed_files"][number];
  symbols: AppliedOutcome["changed_symbols"][number];
};
type FileEditOperation = Exclude<EditCodeOperation, { target: unknown }>;

type TranslatedBatch = {
  errors: Map<number, unknown>;
  operations: Array<ChangeOperation | undefined>;
  resolvedTargets: Array<ResolvedTarget | undefined>;
};

type PreparedEditGroup = {
  group: EditGroup;
  input: NormalizedEditCodeInput;
  inputDigest: string;
  receiptKey: string;
  operations: ChangeOperation[];
  resolvedTargets: ResolvedTarget[];
  proposal?: StoredChangeProposal;
  validations?: ContentValidation[];
  result?: EditCodeOutcome;
};

export class EditService {
  private readonly changes: ChangeService;
  private readonly files: WorkspaceFiles;
  private readonly receipts: EditReceiptStore;
  private readonly resolver: SemanticReferenceResolver;
  private readonly sessionId: string;
  private readonly conflicts: EditConflictCircuit;

  constructor(
    files: WorkspaceFiles,
    changes: ChangeService,
    sessionId = "unscoped-session",
  ) {
    this.files = files;
    this.changes = changes;
    this.receipts = new EditReceiptStore(files.root);
    this.resolver = new SemanticReferenceResolver(files);
    this.sessionId = sessionId;
    this.conflicts = new EditConflictCircuit(files.root, sessionId);
  }

  async edit(input: EditCodeInput, context: EditExecutionContext = {}) {
    const parsedInput = normalizeEditCodeInput(
      editCodeInputSchema.parse(input),
    );
    const normalizedInput = stableJson(parsedInput);
    const inputDigest = sha256(normalizedInput);
    const toolCallId = context.toolCallId ?? `direct-${inputDigest}`;
    const sessionId = context.sessionId ?? this.sessionId;
    const receiptKey = `${sessionId}\0${toolCallId}\0${inputDigest}`;
    return this.receipts.exclusive(receiptKey, async () => {
      const existing = await this.receipts.read<EditCodeOutcome>(
        receiptKey,
        inputDigest,
      );
      if (existing) return existing;
      const result = await this.execute(parsedInput, receiptKey);
      return this.receipts.write(receiptKey, inputDigest, result);
    });
  }

  private async execute(input: NormalizedEditCodeInput, receiptKey: string) {
    const snapshot = await this.files.snapshot();
    const preparationSourceRevision = snapshot.revision.source_revision_id;
    const translated = await this.translate(input.edits, snapshot);
    const atomicity = input.atomicity ?? "all";
    const groups = createEditGroups(
      input.edits,
      translated.operations,
      atomicity,
    );
    const prepared: PreparedEditGroup[] = [];
    for (const [index, group] of groups.entries())
      prepared.push(
        await this.prepareGroup(
          input,
          group,
          translated,
          snapshot,
          `${receiptKey}\0group-${index}`,
        ),
      );
    const results: EditGroupResult[] = [];
    for (const group of prepared)
      results.push({
        group: group.group,
        result: await this.commitPreparedGroup(group),
      });
    return {
      ...combineEditGroupResults(results),
      ...editBatchContract(results, preparationSourceRevision, atomicity),
    };
  }

  private async prepareGroup(
    batchInput: NormalizedEditCodeInput,
    group: EditGroup,
    translated: TranslatedBatch,
    snapshot: WorkspaceSnapshot,
    receiptKey: string,
  ): Promise<PreparedEditGroup> {
    const input = { ...batchInput, edits: group.edits };
    const inputDigest = sha256(stableJson(input));
    const operations = group.indexes.flatMap((index) => {
      const operation = translated.operations[index];
      return operation ? [operation] : [];
    });
    const resolvedTargets = group.indexes.flatMap((index) => {
      const target = translated.resolvedTargets[index];
      return target ? [target] : [];
    });
    const base = {
      group,
      input,
      inputDigest,
      receiptKey,
      operations,
      resolvedTargets,
    };
    const failedIndex = group.indexes.find((index) =>
      translated.errors.has(index),
    );
    if (failedIndex !== undefined)
      return {
        ...base,
        result: operationFailure(
          translated.errors.get(failedIndex),
          group.indexes.indexOf(failedIndex),
        ),
      };
    if (await this.conflicts.blocked(input.edits))
      return { ...base, result: repeatedConflictResult() };
    try {
      const proposal = await this.proposeEdit(
        input,
        snapshot,
        operations,
        receiptKey,
        0,
      );
      const validations = await this.validateProposal(proposal);
      const failure = failedValidation(proposal, validations);
      return failure
        ? {
            ...base,
            result: {
              ...failure,
              failed_operation_indexes: failedValidationIndexes(
                operations,
                validations,
              ),
            },
          }
        : { ...base, proposal, validations };
    } catch (error) {
      const result =
        error instanceof NoChangesProposed
          ? noChangeResult(snapshot.revision.source_revision_id, inputDigest)
          : (knownEditFailure(error) ?? messageFailure(errorMessage(error)));
      return { ...base, result };
    }
  }

  private async commitPreparedGroup(prepared: PreparedEditGroup) {
    const result = prepared.result ?? (await this.applyPreparedGroup(prepared));
    if (result.status === "applied")
      await this.conflicts.recordApplied(prepared.input.edits);
    if (result.status === "conflict")
      await this.conflicts.recordConflict(prepared.input.edits);
    return result;
  }

  private async applyPreparedGroup(
    prepared: PreparedEditGroup,
  ): Promise<EditCodeOutcome> {
    try {
      const receipt = await this.commitEdit(
        prepared.proposal!,
        prepared.receiptKey,
        prepared.inputDigest,
      );
      const newSymbolRefs = await this.newSymbolReferences(
        prepared.input,
        prepared.proposal!,
        receipt.source_revision.source_revision_id,
      );
      return appliedResult({
        attempt: 0,
        changedDetails: await this.changedDetails(prepared.proposal!),
        validations: prepared.validations!,
        proposal: prepared.proposal!,
        rebased: prepared.resolvedTargets.some(
          (target) => target.resolution === "automatically_rebased",
        ),
        rebaseStrategies: uniqueStrings(
          prepared.resolvedTargets
            .filter((target) => target.resolution === "automatically_rebased")
            .map((target) => target.strategy),
        ),
        resolutionReceipts: prepared.resolvedTargets.map(
          (target) => target.receipt,
        ),
        receipt,
        newSymbolRefs,
      });
    } catch (error) {
      return knownEditFailure(error) ?? messageFailure(errorMessage(error));
    }
  }

  private async validateProposal(proposal: StoredChangeProposal) {
    const paths = proposal.changes.map(({ path }) => path);
    return Promise.all(
      proposal.changes.map(async (change) => {
        const contents = await this.changes.proposalFileContents(change);
        return validateContent({
          content: contents.after ?? null,
          externalValidation: proposalValidationMode(change.path, paths),
          path: change.path,
          workspaceRoot: this.files.root,
        });
      }),
    );
  }

  private async newSymbolReferences(
    input: NormalizedEditCodeInput,
    proposal: StoredChangeProposal,
    revision: string,
  ) {
    const references = await Promise.all(
      input.edits
        .filter(hasSemanticTarget)
        .map((edit) => this.newSymbolReference(edit, proposal, revision)),
    );
    return references.filter((value): value is string => Boolean(value));
  }

  private async newSymbolReference(
    edit: Extract<EditCodeOperation, { target: unknown }>,
    proposal: StoredChangeProposal,
    revision: string,
  ) {
    if (!("symbol_ref" in edit.target)) return undefined;
    const original = decodeSymbol(edit.target.symbol_ref);
    if (!original) return undefined;
    const candidate = await this.editedSymbolCandidate(original, proposal);
    return candidate
      ? materializeSymbol({
          symbol: candidate.symbol,
          path: candidate.path,
          revision,
          content: candidate.content,
        }).symbol_ref
      : undefined;
  }

  private async editedSymbolCandidate(
    original: HandlePayload,
    proposal: StoredChangeProposal,
  ) {
    for (const change of proposal.changes) {
      const contents = await this.changes.proposalFileContents(change);
      if (!contents.after) continue;
      const symbol = matchingEditedSymbol(
        original,
        change.path,
        contents.after,
      );
      if (symbol) return { symbol, path: change.path, content: contents.after };
    }
    return undefined;
  }

  private proposeEdit(
    input: NormalizedEditCodeInput,
    snapshot: WorkspaceSnapshot,
    operations: ChangeOperation[],
    receiptKey: string,
    attempt: number,
  ) {
    return this.changes.propose(
      {
        action: "propose",
        base_source_revision_id: snapshot.revision.source_revision_id,
        idempotency_key: `edit-proposal:${sha256(`${receiptKey}\0${attempt}`)}`,
        operations,
        policies: {
          format: formattingPolicy(input.formatting),
          max_touched_files: 50,
        },
      },
      snapshot,
    );
  }

  private commitEdit(
    proposal: StoredChangeProposal,
    receiptKey: string,
    inputDigest: string,
  ) {
    return this.changes.commitResolved({
      action: "commit_proposal",
      proposal_ref: proposal.proposal_ref,
      expected_base_source_revision_id: proposal.base_source_revision_id,
      idempotency_key: `edit-commit:${sha256(`${receiptKey}\0${inputDigest}`)}`,
    });
  }

  private changedDetails(proposal: StoredChangeProposal) {
    return Promise.all(
      proposal.changes.map(async (change) => {
        const contents = await this.changes.proposalFileContents(change);
        return {
          file: {
            path: change.path,
            old_hash: change.old_hash,
            new_hash: change.new_hash,
            ...lineChanges(contents.before, contents.after),
          },
          symbols: {
            path: change.path,
            ...semanticSymbolDiff(change.path, contents.before, contents.after),
          },
        } satisfies ChangedDetail;
      }),
    );
  }

  private async translate(
    edits: EditCodeOperation[],
    snapshot: WorkspaceSnapshot,
  ) {
    const operations: Array<ChangeOperation | undefined> = [];
    const resolvedTargets: Array<ResolvedTarget | undefined> = [];
    const errors = new Map<number, unknown>();
    for (const [index, edit] of edits.entries()) {
      try {
        assertNoManagedLockfileEdits([edit]);
        if (hasNamedSymbolTarget(edit)) {
          const translated = await this.translateNamedTarget(edit, snapshot);
          resolvedTargets.push(translated.resolved);
          operations.push(translated.operation);
        } else if (hasSemanticTarget(edit)) {
          const translated = await this.translateTarget(edit, snapshot);
          resolvedTargets.push(translated.resolved);
          operations.push(translated.operation);
        } else {
          resolvedTargets.push(undefined);
          operations.push(await this.fileOperation(edit));
        }
      } catch (error) {
        operations.push(undefined);
        resolvedTargets.push(undefined);
        errors.set(index, error);
      }
    }
    return {
      operations,
      errors,
      resolvedTargets,
    };
  }

  private async translateTarget(
    edit: Extract<EditCodeOperation, { target: unknown }>,
    snapshot: WorkspaceSnapshot,
  ) {
    if ("path" in edit && edit.path)
      assertSemanticEditSupported(this.files.normalizePath(edit.path));
    const semantic = await this.resolver.resolve(edit.target, snapshot, {
      mode: "write",
      operation: semanticWriteOperation(edit.operation),
      casGenerated: true,
      postValidationAvailable: true,
    });
    const resolved = resolvedTarget(semantic);
    if (
      "path" in edit &&
      edit.path &&
      this.files.normalizePath(edit.path) !== resolved.path
    )
      throw new SemanticResolutionConflict(
        `The symbol resolves to ${resolved.path}, not ${edit.path}.`,
        [],
      );
    assertSemanticEditSupported(resolved.path);
    return { operation: await this.targetOperation(edit, resolved), resolved };
  }

  private async translateNamedTarget(
    edit: Extract<EditCodeOperation, { symbol: string }>,
    snapshot: WorkspaceSnapshot,
  ) {
    const target = {
      symbol_ref: await this.namedSymbolReference(
        edit.path,
        edit.symbol,
        snapshot,
      ),
    };
    if (edit.operation === "replace_symbol")
      return this.translateTarget(
        { ...edit, target, content: edit.replacement },
        snapshot,
      );
    if (edit.operation === "delete_symbol")
      return this.translateTarget({ ...edit, target }, snapshot);
    return this.translateTarget(
      {
        operation:
          edit.position === "before" ? "insert_before" : "insert_after",
        target,
        content: edit.content,
      },
      snapshot,
    );
  }

  private async namedSymbolReference(
    path: string,
    name: string,
    snapshot: WorkspaceSnapshot,
  ) {
    const normalizedPath = this.files.normalizePath(path);
    const file = await this.files.read(normalizedPath);
    const parsed = parseCode(normalizedPath, file.content);
    const candidates = parsed.symbols.filter(
      (symbol) => symbol.name === name || symbol.qualified_name === name,
    );
    const materialized = candidates.map((symbol) =>
      materializeSymbol({
        symbol,
        path: normalizedPath,
        revision: snapshot.revision.source_revision_id,
        content: file.content,
      }),
    );
    if (materialized.length === 1) return materialized[0]!.symbol_ref;
    throw new SemanticResolutionConflict(
      materialized.length
        ? `The symbol name ${name} is ambiguous in ${normalizedPath}.`
        : `The symbol ${name} was not found in ${normalizedPath}.`,
      materialized
        .slice(0, 5)
        .map((symbol) => namedConflictCandidate(normalizedPath, symbol)),
    );
  }

  private async fileOperation(edit: FileEditOperation) {
    if (hasNamedSymbolTarget(edit))
      throw new Error("Named symbol edit was not resolved.");
    if (edit.operation === "create_file") {
      assertTextFile(edit.path, Buffer.from(edit.content));
      return {
        kind: "create_file" as const,
        path: edit.path,
        content: edit.content,
      };
    }
    if (edit.operation === "move_file")
      return {
        kind: "move_file" as const,
        from_path: edit.from_path,
        to_path: edit.to_path,
        expected_blob_hash: await this.files.blobHash(edit.from_path),
      };
    if (edit.operation === "replace_file")
      return this.replaceFileOperation(edit.path, edit.content);
    if (edit.operation === "insert_text") return this.insertTextOperation(edit);
    if (edit.operation === "delete_file")
      return {
        kind: "delete_file" as const,
        path: edit.path,
        expected_blob_hash: await this.files.blobHash(edit.path),
      };
    if (edit.operation === "edit_json") return this.jsonOperation(edit);
    if (
      edit.operation === "ensure_import" ||
      edit.operation === "remove_import"
    )
      return this.importOperation(edit);
    return this.patchOperation(edit);
  }

  private async importOperation(
    edit: Extract<
      FileEditOperation,
      { operation: "ensure_import" | "remove_import" }
    >,
  ) {
    const file = await this.files.read(edit.path);
    assertSemanticEditSupported(edit.path);
    const source = file.content.toString("utf8");
    const change = importTextEdit(source, edit);
    const start = Buffer.byteLength(source.slice(0, change.start));
    const end = Buffer.byteLength(source.slice(0, change.end));
    return {
      kind: "text_replace" as const,
      path: edit.path,
      expected_blob_hash: sha256(file.content),
      range_utf8_bytes: [start, end] as [number, number],
      expected_old_text: source.slice(change.start, change.end),
      replacement: change.replacement,
    };
  }

  private async replaceFileOperation(path: string, replacement: string) {
    const file = await this.files.read(path);
    assertTextFile(path, file.content);
    return {
      kind: "text_replace" as const,
      path,
      expected_blob_hash: sha256(file.content),
      range_utf8_bytes: [0, file.content.byteLength] as [number, number],
      expected_old_text: file.content.toString("utf8"),
      replacement,
    };
  }

  private async insertTextOperation(
    edit: Extract<FileEditOperation, { operation: "insert_text" }>,
  ) {
    const file = await this.files.read(edit.path);
    assertTextFile(edit.path, file.content);
    const offset = edit.position === "start" ? 0 : file.content.byteLength;
    return {
      kind: "text_replace" as const,
      path: edit.path,
      expected_blob_hash: sha256(file.content),
      range_utf8_bytes: [offset, offset] as [number, number],
      expected_old_text: "",
      replacement: edit.content,
    };
  }

  private async jsonOperation(
    edit: Extract<FileEditOperation, { operation: "edit_json" }>,
  ) {
    const file = await this.files.read(edit.path);
    const capability = languageCapability(edit.path, file.content);
    if (!capability.structuredEditing)
      throw new UnsupportedEditOperation(
        "STRUCTURED_EDIT_UNSUPPORTED",
        `Structured JSON editing is unavailable for ${edit.path}.`,
        "replace_file",
      );
    const replacement = editJsonContent(
      file.content.toString("utf8"),
      edit.operations,
    );
    return this.replaceFileOperation(edit.path, replacement);
  }

  private async patchOperation(
    edit: Extract<FileEditOperation, { operation: "patch" | "patch_file" }>,
  ): Promise<ChangeOperation> {
    const file = await this.files.read(edit.path);
    assertTextFile(edit.path, file.content);
    const source = file.content.toString("utf8");
    const patched = await recoverPatch({
      patch: edit.patch,
      path: edit.path,
      source,
      workspaceRoot: this.files.root,
    });
    return {
      kind: "text_replace",
      path: edit.path,
      expected_blob_hash: sha256(file.content),
      range_utf8_bytes: [0, file.content.byteLength],
      expected_old_text: source,
      replacement: patched.content,
    };
  }

  private async targetOperation(
    edit: Extract<EditCodeOperation, { target: unknown }>,
    resolved: ResolvedTarget,
  ): Promise<ChangeOperation> {
    if (edit.operation === "replace" || edit.operation === "replace_symbol")
      return {
        kind: "replace_node",
        target: resolved.target,
        replacement: edit.content,
      };
    if (edit.operation === "insert_before" || edit.operation === "insert_after")
      return this.semanticBoundaryOperation(edit, resolved);
    if (
      edit.operation === "replace_body" ||
      edit.operation === "replace_signature"
    )
      return this.symbolPartOperation(edit, resolved);
    if (edit.operation === "delete" || edit.operation === "delete_symbol")
      return this.semanticBoundaryOperation(edit, resolved);
    if (!isCssEdit(edit))
      throw new Error(`Unsupported semantic edit operation: ${edit.operation}`);
    return this.cssDeclarationOperation(edit, resolved);
  }

  private async semanticBoundaryOperation(
    edit: Extract<
      EditCodeOperation,
      {
        operation:
          | "delete"
          | "delete_symbol"
          | "insert_after"
          | "insert_before";
      }
    >,
    resolved: ResolvedTarget,
  ) {
    const file = await this.files.read(resolved.path);
    const range = syntaxBoundaryRange(resolved.path, file.content, [
      resolved.handle.start,
      resolved.handle.end,
    ]);
    const insertion =
      edit.operation === "insert_before" || edit.operation === "insert_after";
    const offset = edit.operation === "insert_after" ? range[1] : range[0];
    const selected = insertion ? ([offset, offset] as [number, number]) : range;
    return {
      kind: "text_replace" as const,
      path: resolved.path,
      expected_blob_hash: sha256(file.content),
      range_utf8_bytes: selected,
      expected_old_text: file.content.subarray(...selected).toString("utf8"),
      replacement: insertion ? edit.content : "",
    };
  }

  private async symbolPartOperation(
    edit: Extract<
      EditCodeOperation,
      { operation: "replace_body" | "replace_signature" }
    >,
    resolved: ResolvedTarget,
  ): Promise<ChangeOperation> {
    const file = await this.files.read(resolved.path);
    const symbol = parseCode(resolved.path, file.content).symbols.find(
      (candidate) =>
        candidate.range_utf8_bytes[0] === resolved.handle.start &&
        candidate.range_utf8_bytes[1] === resolved.handle.end,
    );
    if (!symbol)
      throw new SemanticResolutionConflict(
        "The resolved symbol is unavailable.",
        [],
      );
    const range = symbolEditRange(
      symbol,
      edit.operation === "replace_body" ? "body" : "signature",
    );
    return {
      kind: "text_replace",
      path: resolved.path,
      expected_blob_hash: sha256(file.content),
      range_utf8_bytes: range,
      expected_old_text: file.content.subarray(...range).toString("utf8"),
      replacement: edit.content,
    };
  }

  private async cssDeclarationOperation(
    edit: Extract<
      EditCodeOperation,
      {
        operation:
          | "insert_css_declaration"
          | "remove_css_declaration"
          | "set_css_declaration"
          | "set_css_declarations";
      }
    >,
    resolved: ResolvedTarget,
  ): Promise<ChangeOperation> {
    if (resolved.handle.kind !== "css_rule")
      throw new SemanticResolutionConflict(
        "CSS declarations can only target a selector rule.",
        [],
      );
    const file = await this.files.read(resolved.path);
    const source = file.content
      .subarray(resolved.handle.start, resolved.handle.end)
      .toString("utf8");
    return {
      kind: "replace_node",
      target: resolved.target,
      replacement: applyCssEdit(source, edit),
    };
  }
}

function formattingPolicy(formatting: NormalizedEditCodeInput["formatting"]) {
  return formatting === "touched_files"
    ? ("touched_files" as const)
    : ("none" as const);
}

function failedValidation(
  proposal: StoredChangeProposal,
  validations: ContentValidation[],
): Extract<EditCodeOutcome, { status: "validation_failed" }> | undefined {
  const rejected = validations.some(rejectedValidation);
  if (!rejected) return undefined;
  return {
    status: "validation_failed",
    outcome: "validation_failed",
    diagnostics: proposal.diagnostics,
    validation: validations,
    proposed_diff_artifact_ref: proposal.diff_artifact.ref,
  };
}

function failedValidationIndexes(
  operations: ChangeOperation[],
  validations: ContentValidation[],
) {
  const rejectedPaths = new Set(
    validations.filter(rejectedValidation).map(({ path }) => path),
  );
  return failedChangeOperationIndexes(operations, rejectedPaths);
}

function rejectedValidation({ status }: ContentValidation) {
  return status === "failed";
}

function appliedResult(input: {
  attempt: number;
  changedDetails: ChangedDetail[];
  validations: ContentValidation[];
  proposal: StoredChangeProposal;
  rebased: boolean;
  rebaseStrategies: string[];
  resolutionReceipts: SemanticResolutionReceipt[];
  receipt: Awaited<ReturnType<ChangeService["commitResolved"]>>;
  newSymbolRefs: string[];
}): AppliedOutcome {
  const status = aggregateValidationStatus(input.validations);
  return {
    status: "applied",
    outcome: "applied",
    changed: true,
    receipt_ref: input.receipt.change_set_ref,
    receipt_refs: [input.receipt.change_set_ref],
    file_receipts: [
      {
        receipt_ref: input.receipt.change_set_ref,
        diff_artifact_ref: input.proposal.diff_artifact.ref,
        paths: input.proposal.changes.map((change) => change.path),
      },
    ],
    source_revision: input.receipt.source_revision.source_revision_id,
    changed_files: input.changedDetails.map(({ file }) => file),
    changed_symbols: input.changedDetails.map(({ symbols }) => symbols),
    resolution: input.rebased ? "automatically_rebased" : "exact",
    ...(input.rebaseStrategies.length
      ? { semantic_rebase_strategy: input.rebaseStrategies.join("+") }
      : {}),
    semantic_resolution_receipts: input.resolutionReceipts,
    new_symbol_refs: input.newSymbolRefs,
    validation: {
      status,
      validator: aggregateValidator(input.validations),
      files: input.validations,
      parse:
        status === "passed"
          ? "passed"
          : status === "unsupported"
            ? "unsupported"
            : "failed",
      diagnostics: input.proposal.diagnostics,
    },
    diff_artifact_ref: input.proposal.diff_artifact.ref,
    diff_artifact_refs: [input.proposal.diff_artifact.ref],
    internal_retries: input.attempt,
  };
}

function resolvedTarget(resolved: ResolvedSemanticReference): ResolvedTarget {
  return {
    handle: resolved.handle,
    path: resolved.path,
    resolution: resolved.rebased ? "automatically_rebased" : "exact",
    receipt: resolved.receipt,
    strategy: resolved.strategy,
    target: resolved.reference,
  };
}

function semanticWriteOperation(
  operation: Extract<EditCodeOperation, { target: unknown }>["operation"],
): SemanticResolutionInput["operation"] {
  if (operation === "replace_body") return "replace_body";
  if (operation === "replace_signature") return "replace_signature";
  if (operation === "insert_before" || operation === "insert_after")
    return "insert_sibling";
  if (operation === "delete" || operation === "delete_symbol")
    return "delete_symbol";
  return "replace_symbol";
}

function applyCssEdit(
  source: string,
  edit: Extract<
    EditCodeOperation,
    {
      operation:
        | "insert_css_declaration"
        | "remove_css_declaration"
        | "set_css_declaration"
        | "set_css_declarations";
    }
  >,
) {
  if (edit.operation === "set_css_declaration")
    return editCssDeclaration(source, {
      operation: "set",
      property: edit.property,
      value: edit.value,
    });
  if (edit.operation === "remove_css_declaration")
    return editCssDeclaration(source, {
      operation: "remove",
      property: edit.property,
    });
  if (edit.operation === "insert_css_declaration")
    return editCssDeclaration(source, {
      operation: "insert",
      property: edit.property,
      value: edit.value,
      ...(edit.after_property ? { afterProperty: edit.after_property } : {}),
    });
  return Object.entries(edit.declarations).reduce(
    (content, [property, value]) =>
      editCssDeclaration(
        content,
        value === null
          ? { operation: "remove", property }
          : { operation: "set", property, value },
      ),
    source,
  );
}

function isCssEdit(
  edit: Extract<EditCodeOperation, { target: unknown }>,
): edit is Extract<
  EditCodeOperation,
  {
    operation:
      | "insert_css_declaration"
      | "remove_css_declaration"
      | "set_css_declaration"
      | "set_css_declarations";
  }
> {
  return [
    "insert_css_declaration",
    "remove_css_declaration",
    "set_css_declaration",
    "set_css_declarations",
  ].includes(edit.operation);
}

function hasSemanticTarget(
  edit: EditCodeOperation,
): edit is Extract<EditCodeOperation, { target: unknown }> {
  return "target" in edit;
}

function hasNamedSymbolTarget(
  edit: EditCodeOperation,
): edit is Extract<EditCodeOperation, { symbol: string }> {
  return "symbol" in edit;
}

function namedConflictCandidate(
  path: string,
  symbol: {
    symbol_ref: string;
    kind: string;
    qualified_name: string;
    line_range: [number, number];
    signature: string;
  },
) {
  return {
    referenceId: symbol.symbol_ref,
    path,
    symbolKind: symbol.kind,
    qualifiedName: symbol.qualified_name,
    line: symbol.line_range[0],
    score: 1,
    excerpt: symbol.signature,
    target_ref: symbol.symbol_ref,
    kind: symbol.kind,
    line_range: symbol.line_range,
  };
}

function assertSemanticEditSupported(path: string) {
  if (languageCapability(path).semanticEditing) return;
  throw new UnsupportedEditOperation(
    "SEMANTIC_EDIT_UNSUPPORTED",
    `Semantic editing is unavailable for ${path}.`,
    languageCapability(path).structuredEditing ? "edit_json" : "patch_file",
  );
}

function assertTextFile(path: string, content: Buffer) {
  if (languageCapability(path, content).level !== "unsupported") return;
  throw new UnsupportedEditOperation(
    "BINARY_FILE_UNSUPPORTED",
    `Text editing is unavailable for binary file ${path}.`,
    "none",
  );
}

function repeatedConflictResult(): EditCodeOutcome {
  return {
    status: "conflict",
    outcome: "conflict",
    reason: "REPEATED_SEMANTIC_CONFLICT",
    candidates: [],
    retrySuppressed: true,
    recommendedTool: "replace_file",
  };
}

function noChangeResult(
  sourceRevision: string,
  inputDigest: string,
): EditCodeOutcome {
  return {
    status: "no_change",
    outcome: "no_change",
    changed: false,
    postcondition_evidence_ref: `evidence://postcondition/${sha256(`${sourceRevision}\0${inputDigest}`)}`,
    postcondition_satisfied: true,
    source_revision: sourceRevision,
  };
}

function unsupportedResult(
  message: string,
  reasonCode: string,
  recommendedTool: string,
): EditCodeOutcome {
  return {
    status: "unsupported_operation",
    outcome: "unsupported_operation",
    reason: message,
    reasonCode,
    recommendedTool,
  };
}

function assertNoManagedLockfileEdits(edits: EditCodeOperation[]) {
  const lockfilePattern =
    /(?:^|\/)(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/u;
  for (const edit of edits) {
    const values = edit as unknown as Record<string, unknown>;
    const paths = [values.path, values.from_path, values.to_path].filter(
      (value): value is string => typeof value === "string",
    );
    if (paths.some((path) => lockfilePattern.test(path)))
      throw new UnsupportedEditOperation(
        "MANAGED_LOCKFILE",
        "Lockfiles are managed exclusively by mutate_dependencies.",
        "mutate_dependencies",
      );
  }
}

function knownEditFailure(error: unknown) {
  return (
    recoveryFailure(error) ??
    conflictFailure(error) ??
    unsupportedFailure(error)
  );
}

function operationFailure(error: unknown, localIndex: number) {
  const result = knownEditFailure(error) ?? messageFailure(errorMessage(error));
  return {
    ...result,
    failed_operation_indexes: [localIndex],
  } as EditCodeOutcome;
}

function recoveryFailure(error: unknown): EditCodeOutcome | undefined {
  if (!(error instanceof IncompleteRollbackError)) return undefined;
  return {
    status: "recovery_required",
    outcome: "conflict",
    reason: error.message,
    recovery_artifact_ref: error.recovery_artifact_ref,
    source_revision: error.source_revision_after,
  };
}

function conflictFailure(error: unknown): EditCodeOutcome | undefined {
  if (error instanceof SemanticResolutionConflict)
    return conflictResult(error.message, error.candidates);
  if (error instanceof PatchRecoveryConflict)
    return { status: "conflict", outcome: "conflict", ...error.details };
  return undefined;
}

function unsupportedFailure(error: unknown): EditCodeOutcome | undefined {
  if (error instanceof UnsupportedPatchOperation)
    return unsupportedResult(
      error.message,
      error.reason,
      error.recommendedTool,
    );
  if (error instanceof UnsupportedEditOperation)
    return unsupportedResult(
      error.message,
      error.reason,
      error.recommendedTool,
    );
  return undefined;
}

function messageFailure(message: string): EditCodeOutcome {
  if (deniedMessage(message))
    return {
      status: "denied",
      outcome: "unsupported_operation",
      reason: message,
    };
  if (infrastructureMessage(message))
    return {
      status: "infrastructure_error",
      outcome: "infrastructure_error",
      reason: message,
    };
  return conflictResult(message, []);
}

function conflictResult(
  reason: string,
  candidates: Array<ConflictCandidate | { line: number; excerpt: string }>,
): EditCodeOutcome {
  return { status: "conflict", outcome: "conflict", reason, candidates };
}

function decodeSymbol(reference: string) {
  return decodeHandle(reference, "sym");
}

function matchingEditedSymbol(
  original: HandlePayload,
  path: string,
  content: Buffer,
) {
  const matches = parseCode(path, content).symbols.filter(
    (symbol) =>
      (!original.kind || symbol.kind === original.kind) &&
      (!original.qualifiedName ||
        symbol.qualified_name === original.qualifiedName),
  );
  return matches[original.ordinal ?? 0] ?? matches[0];
}

class UnsupportedEditOperation extends Error {
  readonly reason: string;
  readonly recommendedTool: string;

  constructor(reason: string, message: string, recommendedTool: string) {
    super(message);
    this.reason = reason;
    this.recommendedTool = recommendedTool;
  }
}

function deniedMessage(message: string) {
  return /outside the workspace|escapes the workspace|policy protects|absolute paths are not allowed|symbolic-link/i.test(
    message,
  );
}

function infrastructureMessage(message: string) {
  return /\b(?:eacces|emfile|enospc|io_error|read-only file system)\b/iu.test(
    message,
  );
}

function proposalValidationMode(path: string, proposalPaths: string[]) {
  if (!path.toLowerCase().endsWith(".prisma")) return "enabled" as const;
  const supportingProjectStateChanged = proposalPaths.some(
    (candidate) =>
      candidate !== path &&
      /(?:^|\/)(?:package\.json|\.env(?:\..*)?|prisma\.config\.[cm]?[jt]s)$/iu.test(
        candidate,
      ),
  );
  return supportingProjectStateChanged ? "unsupported" : "enabled";
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)];
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
