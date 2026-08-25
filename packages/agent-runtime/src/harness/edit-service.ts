import { parseCode, symbolEditRange } from "./code-intelligence.js";
import { ChangeService } from "./change-service.js";
import { stableJson } from "./change-store.js";
import { lineChanges } from "./edit-content.js";
import { editCssDeclaration } from "./css-declaration-editor.js";
import { PatchRecoveryConflict, recoverPatch } from "./patch-recovery.js";
import { EditReceiptStore } from "./edit-receipt-store.js";
import { sha256, type HandlePayload } from "./protocol.js";
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
      internal_retries: number;
      receipt_ref: string;
      resolution: "exact" | "automatically_rebased";
      semantic_rebase_strategy?: string;
      source_revision: string;
      status: "applied";
      validation: {
        parse: "passed" | "skipped";
        diagnostics: StoredChangeProposal["diagnostics"];
      };
    }
  | {
      candidates: Array<ConflictCandidate | { line: number; excerpt: string }>;
      current_context?: string;
      failed_hunk?: string;
      reason: string;
      recommended_strategy?: string;
      status: "conflict";
    }
  | {
      diagnostics: StoredChangeProposal["diagnostics"];
      proposed_diff_artifact_ref: string;
      status: "validation_failed";
    }
  | { reason: string; status: "denied" };

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
      const result = await this.attempt(input, receiptKey, inputDigest);
      return this.receipts.write(receiptKey, inputDigest, result);
    });
  }

  private async attempt(
    input: EditCodeInput,
    receiptKey: string,
    inputDigest: string,
  ): Promise<EditCodeOutcome> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await this.applyAttempt(input, receiptKey, inputDigest, attempt);
      } catch (error) {
        if (error instanceof SemanticResolutionConflict)
          return {
            status: "conflict",
            reason: error.message,
            candidates: error.candidates,
          };
        if (error instanceof PatchRecoveryConflict)
          return {
            status: "conflict",
            ...error.details,
          };
        const message = errorMessage(error);
        if (deniedMessage(message))
          return { status: "denied", reason: message };
        if (attempt === 0 && retryableMessage(message)) continue;
        return { status: "conflict", reason: message, candidates: [] };
      }
    }
    return {
      status: "conflict",
      reason: "The edit could not be resolved on a stable snapshot.",
      candidates: [],
    };
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
    const parseRequested = input.validation?.parse !== false;
    const validationFailure = failedValidation(proposal, parseRequested);
    if (validationFailure) return validationFailure;
    const receipt = await this.commitEdit(proposal, receiptKey, inputDigest);
    const changedDetails = await this.changedDetails(proposal);
    return appliedResult({
      attempt,
      changedDetails,
      parseRequested,
      proposal,
      rebased: translated.rebased,
      rebaseStrategies: translated.rebaseStrategies,
      receipt,
    });
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
    for (const edit of edits) {
      if (hasSemanticTarget(edit)) {
        const semantic = await this.resolver.resolve(edit.target, snapshot);
        const resolved = resolvedTarget(semantic);
        rebased ||= resolved.resolution === "automatically_rebased";
        if (resolved.resolution === "automatically_rebased")
          rebaseStrategies.add(resolved.strategy);
        operations.push(await this.targetOperation(edit, resolved));
        continue;
      }
      operations.push(await this.fileOperation(edit));
    }
    return { operations, rebased, rebaseStrategies: [...rebaseStrategies] };
  }

  private async fileOperation(edit: FileEditOperation) {
    if (edit.operation === "create_file")
      return {
        kind: "create_file" as const,
        path: edit.path,
        content: edit.content,
      };
    if (edit.operation === "move_file")
      return {
        kind: "move_file" as const,
        from_path: edit.from_path,
        to_path: edit.to_path,
        expected_blob_hash: await this.files.blobHash(edit.from_path),
      };
    return this.patchOperation(edit);
  }

  private async patchOperation(
    edit: Extract<FileEditOperation, { operation: "patch" | "patch_file" }>,
  ): Promise<ChangeOperation> {
    const file = await this.files.read(edit.path);
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
  parseRequested: boolean,
): EditCodeOutcome | undefined {
  const increasedErrors = proposal.diagnostics.some(
    (diagnostic) => diagnostic.after_errors > diagnostic.before_errors,
  );
  if (!parseRequested || !increasedErrors) return undefined;
  return {
    status: "validation_failed",
    diagnostics: proposal.diagnostics,
    proposed_diff_artifact_ref: proposal.diff_artifact.ref,
  };
}

function appliedResult(input: {
  attempt: number;
  changedDetails: ChangedDetail[];
  parseRequested: boolean;
  proposal: StoredChangeProposal;
  rebased: boolean;
  rebaseStrategies: string[];
  receipt: Awaited<ReturnType<ChangeService["commitResolved"]>>;
}): AppliedOutcome {
  return {
    status: "applied",
    receipt_ref: input.receipt.change_set_ref,
    source_revision: input.receipt.source_revision.source_revision_id,
    changed_files: input.changedDetails.map(({ file }) => file),
    changed_symbols: input.changedDetails.map(({ symbols }) => symbols),
    resolution: input.rebased ? "automatically_rebased" : "exact",
    ...(input.rebaseStrategies.length
      ? { semantic_rebase_strategy: input.rebaseStrategies.join("+") }
      : {}),
    validation: {
      parse: input.parseRequested ? "passed" : "skipped",
      diagnostics: input.proposal.diagnostics,
    },
    diff_artifact_ref: input.proposal.diff_artifact.ref,
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

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
