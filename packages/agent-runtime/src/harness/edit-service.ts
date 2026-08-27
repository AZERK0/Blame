import {
  materializeSymbol,
  parseCode,
  symbolEditRange,
} from "./code-intelligence.js";
import { ChangeService, NoChangesProposed } from "./change-service.js";
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
  failedChangeOperationIndexes,
  type EditGroupResult,
  type FailedEditOperation,
} from "./edit-batch.js";
import { lineChanges } from "./edit-content.js";
import { editCssDeclaration } from "./css-declaration-editor.js";
import { EditConflictCircuit } from "./edit-conflict-circuit.js";
import { editJsonContent } from "./json-editor.js";
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
  type ChangeOperation,
  type EditCodeInput,
  type EditCodeOperation,
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
  strategy: string;
  target: string;
};

export type EditCodeOutcome =
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
      source_revision: string;
      status: "applied";
      new_symbol_refs: string[];
      validation: {
        status: ValidationStatus;
        validator: string | null;
        files: ContentValidation[];
        parse: "passed" | "pending" | "skipped" | "not_supported";
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
      changed: false;
      outcome: "no_change";
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

type AppliedOutcome = Extract<EditCodeOutcome, { status: "applied" }>;
type ChangedDetail = {
  file: AppliedOutcome["changed_files"][number];
  symbols: AppliedOutcome["changed_symbols"][number];
};
type FileEditOperation = Exclude<EditCodeOperation, { target: unknown }>;

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
    editCodeInputSchema.parse(input);
    const normalizedInput = stableJson(input);
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
      const result = await this.execute(input, receiptKey, inputDigest);
      return this.receipts.write(receiptKey, inputDigest, result);
    });
  }

  private async execute(
    input: EditCodeInput,
    receiptKey: string,
    inputDigest: string,
  ) {
    const groups = createEditGroups(input.edits);
    if (groups.length === 1)
      return this.executeGroup(input, receiptKey, inputDigest);
    const results: EditGroupResult[] = [];
    for (const [index, group] of groups.entries()) {
      const groupInput = { ...input, edits: group.edits };
      const groupDigest = sha256(stableJson(groupInput));
      const result = await this.executeGroup(
        groupInput,
        `${receiptKey}\0group-${index}`,
        groupDigest,
      );
      results.push({ group, result });
    }
    return combineEditGroupResults(results);
  }

  private async executeGroup(
    input: EditCodeInput,
    receiptKey: string,
    inputDigest: string,
  ) {
    const blocked = await this.conflicts.blocked(input.edits);
    const result = blocked
      ? repeatedConflictResult()
      : await this.attempt(input, receiptKey, inputDigest);
    if (result.status === "applied")
      await this.conflicts.recordApplied(input.edits);
    if (result.status === "conflict")
      await this.conflicts.recordConflict(input.edits);
    return result;
  }

  private async attempt(
    input: EditCodeInput,
    receiptKey: string,
    inputDigest: string,
  ): Promise<EditCodeOutcome> {
    try {
      assertNoManagedLockfileEdits(input.edits);
    } catch (error) {
      return knownEditFailure(error) ?? messageFailure(errorMessage(error));
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.applyAttempt(input, receiptKey, inputDigest, attempt);
      } catch (error) {
        if (error instanceof NoChangesProposed)
          return noChangeResult(await this.currentRevision());
        const known = knownEditFailure(error);
        if (known) return known;
        const message = errorMessage(error);
        if (attempt === 0 && retryableMessage(message)) continue;
        return messageFailure(message);
      }
    }
    return messageFailure(
      "The edit could not be resolved on a stable snapshot.",
    );
  }

  private async currentRevision() {
    return (await this.files.snapshot()).revision.source_revision_id;
  }

  private async applyAttempt(
    input: EditCodeInput,
    receiptKey: string,
    inputDigest: string,
    attempt: number,
  ): Promise<EditCodeOutcome> {
    const snapshot = await this.files.snapshot();
    const translated = await this.translate(input.edits, snapshot);
    const proposal = await this.proposeEdit(
      input,
      snapshot,
      translated.operations,
      receiptKey,
      attempt,
    );
    const validations = await this.validateProposal(proposal);
    const validationFailure = failedValidation(proposal, validations);
    if (validationFailure)
      return {
        ...validationFailure,
        failed_operation_indexes: failedValidationIndexes(
          translated.operations,
          validations,
        ),
      };
    const receipt = await this.commitEdit(proposal, receiptKey, inputDigest);
    const changedDetails = await this.changedDetails(proposal);
    const newSymbolRefs = await this.newSymbolReferences(
      input,
      proposal,
      receipt.source_revision.source_revision_id,
    );
    return appliedResult({
      attempt,
      changedDetails,
      validations,
      proposal,
      rebased: translated.rebased,
      rebaseStrategies: translated.rebaseStrategies,
      receipt,
      newSymbolRefs,
    });
  }

  private async validateProposal(proposal: StoredChangeProposal) {
    return Promise.all(
      proposal.changes.map(async (change) => {
        const contents = await this.changes.proposalFileContents(change);
        return validateContent({
          content: contents.after ?? null,
          path: change.path,
          workspaceRoot: this.files.root,
        });
      }),
    );
  }

  private async newSymbolReferences(
    input: EditCodeInput,
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
    input: EditCodeInput,
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
    const operations: ChangeOperation[] = [];
    const rebaseStrategies = new Set<string>();
    let rebased = false;
    for (const [index, edit] of edits.entries()) {
      try {
        if (hasSemanticTarget(edit)) {
          const translated = await this.translateTarget(edit, snapshot);
          rebased ||=
            translated.resolved.resolution === "automatically_rebased";
          if (translated.resolved.resolution === "automatically_rebased")
            rebaseStrategies.add(translated.resolved.strategy);
          operations.push(translated.operation);
        } else operations.push(await this.fileOperation(edit));
      } catch (error) {
        if (error instanceof SemanticResolutionConflict)
          throw new EditOperationResolutionConflict(error, index);
        throw error;
      }
    }
    return { operations, rebased, rebaseStrategies: [...rebaseStrategies] };
  }

  private async translateTarget(
    edit: Extract<EditCodeOperation, { target: unknown }>,
    snapshot: WorkspaceSnapshot,
  ) {
    if ("path" in edit && edit.path)
      assertSemanticEditSupported(this.files.normalizePath(edit.path));
    const semantic = await this.resolver.resolve(edit.target, snapshot);
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

  private async fileOperation(edit: FileEditOperation) {
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
    if (edit.operation === "delete_file")
      return {
        kind: "delete_file" as const,
        path: edit.path,
        expected_blob_hash: await this.files.blobHash(edit.path),
      };
    if (edit.operation === "edit_json") return this.jsonOperation(edit);
    return this.patchOperation(edit);
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
      return {
        kind: edit.operation,
        target: resolved.target,
        source: edit.content,
      };
    if (
      edit.operation === "replace_body" ||
      edit.operation === "replace_signature"
    )
      return this.symbolPartOperation(edit, resolved);
    if (edit.operation === "delete" || edit.operation === "delete_symbol")
      return { kind: "replace_node", target: resolved.target, replacement: "" };
    if (!isCssEdit(edit))
      throw new Error(`Unsupported semantic edit operation: ${edit.operation}`);
    return this.cssDeclarationOperation(edit, resolved);
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

function formattingPolicy(formatting: EditCodeInput["formatting"]) {
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

function rejectedValidation({ path, status }: ContentValidation) {
  return (
    status === "failed" ||
    (status === "not_supported" && requiresValidatedEdit(path))
  );
}

function requiresValidatedEdit(path: string) {
  const capability = languageCapability(path);
  return capability.semanticEditing || capability.structuredEditing;
}

function appliedResult(input: {
  attempt: number;
  changedDetails: ChangedDetail[];
  validations: ContentValidation[];
  proposal: StoredChangeProposal;
  rebased: boolean;
  rebaseStrategies: string[];
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
    new_symbol_refs: input.newSymbolRefs,
    validation: {
      status,
      validator: aggregateValidator(input.validations),
      files: input.validations,
      parse:
        status === "passed"
          ? "passed"
          : status === "validator_unavailable"
            ? "pending"
            : status === "not_supported"
              ? "not_supported"
              : "skipped",
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
    strategy: resolved.strategy,
    target: resolved.reference,
  };
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

function noChangeResult(sourceRevision: string): EditCodeOutcome {
  return {
    status: "no_change",
    outcome: "no_change",
    changed: false,
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
  return conflictFailure(error) ?? unsupportedFailure(error);
}

function conflictFailure(error: unknown): EditCodeOutcome | undefined {
  if (error instanceof EditOperationResolutionConflict)
    return {
      status: "conflict",
      outcome: "conflict",
      reason: error.message,
      candidates: error.candidates,
      failed_operation_indexes: [error.operationIndex],
    };
  if (error instanceof SemanticResolutionConflict)
    return conflictResult(error.message, error.candidates);
  if (error instanceof PatchRecoveryConflict)
    return { status: "conflict", outcome: "conflict", ...error.details };
  return undefined;
}

function unsupportedFailure(error: unknown): EditCodeOutcome | undefined {
  if (error instanceof UnsupportedPatchOperation)
    return unsupportedResult(error.message, error.reason, "edit_files");
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

class EditOperationResolutionConflict extends SemanticResolutionConflict {
  readonly operationIndex: number;

  constructor(conflict: SemanticResolutionConflict, operationIndex: number) {
    super(conflict.message, conflict.candidates);
    this.operationIndex = operationIndex;
  }
}

function deniedMessage(message: string) {
  return /outside the workspace|escapes the workspace|policy protects|absolute paths are not allowed|symbolic-link/i.test(
    message,
  );
}

function retryableMessage(message: string) {
  return /precondition|stale_revision|target bytes changed|file no longer exists/i.test(
    message,
  );
}

function infrastructureMessage(message: string) {
  return /\b(?:eacces|emfile|enospc|io_error|read-only file system)\b/iu.test(
    message,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
