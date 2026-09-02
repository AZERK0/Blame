import {
  parseCode,
  symbolEditRange,
  syntaxBoundaryRange,
} from "./code-intelligence.js";
import {
  validateContent,
  type ContentValidation,
} from "./content-validation.js";
import type { LightEditCodeInput, LightToolResult } from "./light-contracts.js";
import { capabilityForPath, parseAvailability } from "./light-capabilities.js";
import {
  LightAliasRegistry,
  SymbolResolutionError,
  type LightAlias,
  type ResolvedLightSymbol,
} from "./light-aliases.js";
import { planLightPatch, splitLightPatch } from "./light-patch.js";
import {
  LightCommitConflict,
  LightCommitService,
  type LightCommitResult,
} from "./light-commit.js";
import type { SessionJournal } from "./session-journal.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";
import { symbolsTouchedByPatch } from "./patch-symbol-attribution.js";

type Replacement = {
  end: number;
  replacement: string;
  source: string;
  start: number;
};

type PlannedFile = {
  fileMode?: number;
  initial: Buffer | null;
  mutation?: "add" | "delete";
  path: string;
  replacements: Replacement[];
  symbols: string[];
};

type FinalFile = PlannedFile & {
  content: Buffer | null;
  parse: LightParseResult;
};

type LightParseStatus =
  | "passed"
  | "failed"
  | "unsupported"
  | "unavailable"
  | "degraded_preexisting_errors";

type LightParseResult = {
  diagnostics: string[];
  status: LightParseStatus;
};

type EditContext = {
  sessionId?: string;
  toolCallId?: string;
};

type LightEditOptions = {
  files: WorkspaceFiles;
  journal: SessionJournal;
};

export type FormattedFileReplacement = {
  before: Buffer;
  content: string;
  path: string;
};

export class LightEditService {
  private readonly aliases: LightAliasRegistry;
  private readonly commits: LightCommitService;
  private readonly files: WorkspaceFiles;
  private readonly journal: SessionJournal;
  private receiptSequence = 0;

  constructor(aliases: LightAliasRegistry, options: LightEditOptions) {
    this.aliases = aliases;
    this.files = options.files;
    this.journal = options.journal;
    this.commits = new LightCommitService(options.files);
  }

  async edit(
    input: LightEditCodeInput,
    context: EditContext = {},
  ): Promise<LightToolResult<unknown>> {
    try {
      const snapshot = await this.files.snapshot();
      const plans = await this.plan(input, snapshot);
      void context;
      return await this.applyPlans(plans, snapshot);
    } catch (error) {
      return editFailure(error);
    }
  }

  async replaceFiles(
    replacements: FormattedFileReplacement[],
    context: EditContext = {},
  ): Promise<LightToolResult<unknown>> {
    try {
      if (!replacements.length || replacements.length > 50)
        throw new Error("Formatter batch must contain between 1 and 50 files.");
      const snapshot = await this.files.snapshot();
      const plans = await this.replacementPlans(replacements);
      void context;
      return await this.applyPlans(plans, snapshot);
    } catch (error) {
      return editFailure(error);
    }
  }

  private async replacementPlans(replacements: FormattedFileReplacement[]) {
    const plans: PlannedFile[] = [];
    for (const replacement of replacements) {
      const path = this.files.normalizePath(replacement.path);
      const plan = await this.filePlan(new Map(), path);
      if (!plan.initial) throw new Error(`${path} does not exist.`);
      if (!plan.initial.equals(replacement.before))
        throw new LightCommitConflict(`File changed before commit: ${path}.`);
      plan.replacements.push({
        start: 0,
        end: plan.initial.byteLength,
        replacement: replacement.content,
        source: `formatter ${path}`,
      });
      plans.push(plan);
    }
    return plans;
  }

  private async applyPlans(
    plans: PlannedFile[],
    snapshot: WorkspaceSnapshot,
  ): Promise<LightToolResult<unknown>> {
    const finalFiles = await this.finalize(plans);
    const invalid = finalFiles.find(({ parse }) => parse.status === "failed");
    if (invalid) return invalidParseResult(invalid);
    const result: LightCommitResult | LightEditFailure = await this.commit(
      finalFiles,
      snapshot,
    ).catch(commitFailure);
    if (isLightFailure(result)) return result;
    return this.mapResult(result, finalFiles, snapshot);
  }

  private async plan(input: LightEditCodeInput, snapshot: WorkspaceSnapshot) {
    const files = new Map<string, PlannedFile>();
    let operationCount = 0;
    for (const operation of input.operations) {
      if (operation.kind === "patch") {
        operationCount += await this.planPatch(
          files,
          operation.path,
          operation.patch,
          50 - operationCount,
        );
      } else {
        if (operationCount >= 50)
          throw new Error("Edit batch contains too many operations.");
        operationCount += 1;
        await this.planSymbol(files, operation, snapshot);
      }
    }
    for (const file of files.values()) assertCompatibleMutations(file);
    return [...files.values()];
  }

  private async planPatch(
    plans: Map<string, PlannedFile>,
    requestedPath: string | undefined,
    patch: string,
    remainingOperations: number,
  ) {
    const operations = splitLightPatch(patch, requestedPath);
    if (operations.length > remainingOperations)
      throw new Error("Edit batch contains too many operations.");
    for (const operation of operations)
      await this.planPatchFile(plans, operation.path, operation.patch);
    return operations.length;
  }

  private async planPatchFile(
    plans: Map<string, PlannedFile>,
    requestedPath: string,
    patch: string,
  ) {
    const path = this.files.normalizePath(requestedPath);
    const file = await this.filePlan(plans, path);
    const source = file.initial?.toString("utf8");
    const patchPlan = await planLightPatch(
      this.files.root,
      path,
      source,
      patch,
    );
    file.symbols.push(...symbolsTouchedByPatch(path, file.initial, patchPlan));
    applyPatchPlan(file, path, patchPlan);
  }

  private async planSymbol(
    plans: Map<string, PlannedFile>,
    operation: Extract<
      LightEditCodeInput["operations"][number],
      { kind: "symbol" }
    >,
    snapshot: WorkspaceSnapshot,
  ) {
    const resolved = await this.aliases.resolveSymbol(
      operation.target,
      this.files,
      snapshot.revision.source_revision_id,
    );
    assertSymbolEditAvailable(resolved.path);
    const file = await this.filePlan(plans, resolved.path, resolved.content);
    file.symbols.push(resolved.symbol.qualified_name);
    file.replacements.push(symbolReplacement(resolved, operation));
  }

  private async filePlan(
    plans: Map<string, PlannedFile>,
    path: string,
    knownContent?: Buffer,
  ) {
    const existing = plans.get(path);
    if (existing) return existing;
    const file = await optionalFile(this.files, path);
    const initial = knownContent ?? file?.content ?? null;
    const plan: PlannedFile = {
      initial,
      path,
      replacements: [],
      symbols: [],
      ...(file ? { fileMode: file.mode } : {}),
    };
    plans.set(path, plan);
    return plan;
  }

  private async finalize(plans: PlannedFile[]) {
    return Promise.all(
      plans.map(async (plan): Promise<FinalFile> => {
        const content = applyPlan(plan);
        const parse = await finalParseStatus(
          this.files.root,
          plan.path,
          plan.initial,
          content,
        );
        return { ...plan, content, parse };
      }),
    );
  }

  private commit(files: FinalFile[], snapshot: WorkspaceSnapshot) {
    return this.commits.commit(
      files.map((file) => ({
        after: file.content,
        before: file.initial,
        mode: file.fileMode,
        path: file.path,
      })),
      snapshot.revision.source_revision_id,
    );
  }

  private async mapResult(
    result: LightCommitResult,
    files: FinalFile[],
    snapshot: WorkspaceSnapshot,
  ): Promise<LightToolResult<unknown>> {
    if (!result.changedPaths.length)
      return {
        status: "ok",
        data: { changed: false, parse: parseSummary(files) },
      };
    return this.appliedResult(files, snapshot, result);
  }

  private async appliedResult(
    files: FinalFile[],
    snapshot: WorkspaceSnapshot,
    result: LightCommitResult,
  ): Promise<LightToolResult<unknown>> {
    const receipt = `c${++this.receiptSequence}`;
    const paths = result.changedPaths;
    const parse = parseSummary(files);
    await this.journal.recordChange({
      paths,
      receipt,
      sourceRevisionId: result.sourceRevisionId,
      symbols: [...new Set(files.flatMap(({ symbols }) => symbols))],
      parse: parse.status === "passed" ? "passed" : "not_supported",
    });
    const aliases = await this.refreshAliases(
      paths,
      new Set(files.flatMap(({ symbols }) => symbols)),
    );
    await this.journal.recordAliases(this.aliases.entries());
    return appliedEditResult(
      receipt,
      result.sourceRevisionId,
      files,
      aliases,
      parse,
      snapshot,
    );
  }

  private async refreshAliases(paths: string[], touched: Set<string>) {
    const snapshot = await this.files.snapshot();
    const existing = this.aliases.entries();
    const output: Array<{
      alias: string;
      path: string;
      qualifiedName: string;
    }> = [];
    for (const path of paths) {
      const content = (await optionalFile(this.files, path))?.content;
      if (!content) continue;
      const symbols = parseCode(path, content).symbols;
      for (const symbol of symbols) {
        const aliases = matchingAliases(existing, path, symbol);
        if (!aliases.length && !touched.has(symbol.qualified_name)) continue;
        const { alias } = this.aliases.registerSymbol(
          path,
          content,
          symbol,
          snapshot.revision.source_revision_id,
        );
        if (touched.has(symbol.qualified_name))
          output.push({ alias, path, qualifiedName: symbol.qualified_name });
      }
    }
    return uniqueAliasReceipts(output);
  }
}

function matchingAliases(
  aliases: LightAlias[],
  path: string,
  symbol: ReturnType<typeof parseCode>["symbols"][number],
) {
  return aliases.filter(
    (entry) =>
      entry.kind === "symbol" &&
      entry.path === path &&
      entry.qualifiedName === symbol.qualified_name &&
      entry.symbolKind === symbol.kind,
  );
}

function uniqueAliasReceipts(
  aliases: Array<{ alias: string; path: string; qualifiedName: string }>,
) {
  const seen = new Set<string>();
  return aliases.filter(({ alias }) => {
    if (seen.has(alias)) return false;
    seen.add(alias);
    return true;
  });
}

function applyPatchPlan(
  file: PlannedFile,
  path: string,
  patch: Awaited<ReturnType<typeof planLightPatch>>,
) {
  if (patch.mode === "add") {
    if (file.initial) throw new Error(`${path} already exists.`);
    file.mutation = "add";
    file.replacements.push({
      start: 0,
      end: 0,
      replacement: patch.content,
      source: `add ${path}`,
    });
    return;
  }
  if (patch.mode === "delete") {
    if (!file.initial) throw new Error(`${path} does not exist.`);
    file.mutation = "delete";
    return;
  }
  file.replacements.push(
    ...patch.replacements.map((replacement) => ({
      ...replacement,
      source: `patch ${path}`,
    })),
  );
}

function appliedEditResult(
  receipt: string,
  sourceRevisionId: string,
  files: FinalFile[],
  aliases: Array<{ alias: string; path: string; qualifiedName: string }>,
  parse: ReturnType<typeof parseSummary>,
  snapshot: WorkspaceSnapshot,
): LightToolResult<unknown> {
  return {
    status: "ok",
    receipt,
    data: {
      changed: true,
      changes: files.map(fileChange),
      ...(aliases.length ? { aliases } : {}),
      parse,
      basedOn: snapshot.git ? "worktree" : "filesystem",
      sourceRevisionId,
    },
  };
}

function symbolReplacement(
  resolved: ResolvedLightSymbol,
  operation: Extract<
    LightEditCodeInput["operations"][number],
    { kind: "symbol" }
  >,
): Replacement {
  const replacement = operation.content ?? "";
  const source = `${operation.action} ${operation.target}`;
  if (operation.action === "replace_body")
    return symbolBodyReplacement(resolved, replacement, source);
  const range = syntaxBoundaryRange(
    resolved.path,
    resolved.content,
    resolved.symbol.range_utf8_bytes,
  );
  if (operation.action === "insert_before")
    return insertionReplacement(range[0], replacement, source);
  if (operation.action === "insert_after")
    return insertionReplacement(range[1], replacement, source);
  return wholeSymbolReplacement(operation, range, source);
}

function symbolBodyReplacement(
  resolved: ResolvedLightSymbol,
  replacement: string,
  source: string,
): Replacement {
  const [start, end] = symbolEditRange(resolved.symbol, "body");
  const current = resolved.content.subarray(start, end).toString("utf8");
  const baseIndent = lineIndentBefore(resolved.content, start);
  return {
    start,
    end,
    replacement: normalizedSymbolBody(current, replacement, baseIndent),
    source,
  };
}

function normalizedSymbolBody(
  current: string,
  replacement: string,
  baseIndent: string,
) {
  const currentBody = current.trim();
  const proposedBody = replacement.trim();
  if (!isDelimitedBody(currentBody) || isDelimitedBody(proposedBody))
    return replacement;
  if (!proposedBody.includes("\n")) return `{ ${proposedBody} }`;
  const indent = existingBodyIndent(current) ?? `${baseIndent}  `;
  return `{\n${indentedStatements(replacement, indent)}\n${baseIndent}}`;
}

function isDelimitedBody(value: string) {
  return value.startsWith("{") && value.endsWith("}");
}

function lineIndentBefore(content: Buffer, offset: number) {
  const prefix = content.subarray(0, offset).toString("utf8");
  return prefix.match(/(?:^|\n)([\t ]*)[^\n]*$/u)?.[1] ?? "";
}

function existingBodyIndent(body: string) {
  return body.match(/\n([\t ]+)\S/u)?.[1];
}

function indentedStatements(value: string, indent: string) {
  const allLines = value.split(/\r?\n/u);
  const start = allLines.findIndex((line) => line.trim());
  const trailing = [...allLines]
    .reverse()
    .findIndex((line) => line.trim());
  const end = allLines.length - trailing - 1;
  const lines = allLines.slice(start, end + 1);
  const widths = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[\t ]*/u)?.[0].length ?? 0);
  const width = Math.min(...widths);
  return lines
    .map((line) => (line.trim() ? `${indent}${line.slice(width)}` : ""))
    .join("\n");
}

function insertionReplacement(
  offset: number,
  replacement: string,
  source: string,
): Replacement {
  return { start: offset, end: offset, replacement, source };
}

function wholeSymbolReplacement(
  operation: Extract<
    LightEditCodeInput["operations"][number],
    { kind: "symbol" }
  >,
  range: [number, number],
  source: string,
): Replacement {
  return {
    start: range[0],
    end: range[1],
    replacement: operation.action === "delete" ? "" : (operation.content ?? ""),
    source,
  };
}

function assertSymbolEditAvailable(path: string) {
  const capability = capabilityForPath(path);
  if (capability?.loaded && capability.level !== "raw") return;
  throw new SymbolResolutionError(`Symbol editing is unavailable for ${path}.`);
}

async function optionalFile(files: WorkspaceFiles, path: string) {
  try {
    return await files.read(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}

function assertCompatibleMutations(file: PlannedFile) {
  if (file.mutation && file.replacements.length > 1)
    throw new Error(
      `File creation or deletion cannot overlap another edit in ${file.path}.`,
    );
  const ordered = [...file.replacements].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (replacementsOverlap(previous, current))
      throw new Error(
        `Edit operations overlap in ${file.path}: ${previous.source} conflicts with ${current.source}. Replace their common parent once, or split the edits and re-read after the first commit.`,
      );
  }
}

function replacementsOverlap(left: Replacement, right: Replacement) {
  if (isInsertion(left) && isInsertion(right)) return left.start === right.start;
  if (isInsertion(left)) return insertionInside(left.start, right);
  if (isInsertion(right)) return insertionInside(right.start, left);
  return left.start < right.end && right.start < left.end;
}

function isInsertion(replacement: Replacement) {
  return replacement.start === replacement.end;
}

function insertionInside(offset: number, replacement: Replacement) {
  return offset > replacement.start && offset < replacement.end;
}

function applyPlan(plan: PlannedFile) {
  if (plan.mutation === "delete") return null;
  let content = plan.initial ?? Buffer.alloc(0);
  const descending = [...plan.replacements].sort(
    (left, right) => right.start - left.start || right.end - left.end,
  );
  for (const replacement of descending)
    content = Buffer.concat([
      content.subarray(0, replacement.start),
      Buffer.from(replacement.replacement),
      content.subarray(replacement.end),
    ]);
  return content;
}

async function finalParseStatus(
  workspaceRoot: string,
  path: string,
  before: Buffer | null,
  after: Buffer | null,
): Promise<LightParseResult> {
  if (!after) return { diagnostics: [], status: "unsupported" };
  const validation = await validateFinalContent(workspaceRoot, path, after);
  if (validation.status === "passed")
    return { diagnostics: [], status: "passed" };
  if (validation.status === "unsupported")
    return {
      diagnostics: validation.diagnostics,
      status: unsupportedStatus(path),
    };
  return {
    diagnostics: validation.diagnostics,
    status: await failedOrDegraded(
      workspaceRoot,
      path,
      before,
      after,
      validation,
    ),
  };
}

function unsupportedStatus(path: string): LightParseStatus {
  return parseAvailability(path) === "unavailable"
    ? "unavailable"
    : "unsupported";
}

async function failedOrDegraded(
  workspaceRoot: string,
  path: string,
  before: Buffer | null,
  after: Buffer,
  validation: ContentValidation,
): Promise<LightParseStatus> {
  if (!before || validation.status !== "failed") return "failed";
  const previousValidation = await validateFinalContent(
    workspaceRoot,
    path,
    before,
  );
  if (previousValidation.status !== "failed") return "failed";
  const previous = parseCode(path, before);
  const current = parseCode(path, after);
  const errorsDidNotIncrease =
    current.errorCount <= previous.errorCount &&
    validation.diagnostics.length <= previousValidation.diagnostics.length;
  return previous.supported && errorsDidNotIncrease
    ? "degraded_preexisting_errors"
    : "failed";
}

function validateFinalContent(
  workspaceRoot: string,
  path: string,
  content: Buffer,
) {
  return validateContent({
    content,
    externalValidation: path.endsWith(".prisma") ? "unsupported" : "enabled",
    path,
    workspaceRoot,
  });
}

function invalidParseResult(file: FinalFile): LightToolResult<unknown> {
  const diagnostic = file.parse.diagnostics[0];
  return {
    status: "blocked",
    category: "code",
    message: `Final parse failed for ${file.path}; no files were written.${diagnostic ? ` ${diagnostic}` : ""}`,
    recovery: "Correct the final syntax and submit one new atomic batch.",
  };
}

function editFailure(error: unknown): LightToolResult<unknown> {
  const diagnosticId = `edit-${Date.now().toString(36)}`;
  if (error instanceof SymbolResolutionError)
    return {
      status: "blocked",
      category: "input",
      message: error.message,
      ...(error.candidates.length
        ? { recovery: JSON.stringify(error.candidates) }
        : {}),
      diagnosticId,
    };
  const message = errorMessage(error);
  const recovery = patchFailureRecovery(message);
  return {
    status: "blocked",
    category: "input",
    message,
    ...(recovery ? { recovery } : {}),
    diagnosticId,
  };
}

function patchFailureRecovery(message: string) {
  if (/context is ambiguous/iu.test(message))
    return "Do not resend the same patch. Read the affected outline and target its symbol or selector alias, or add one short unique context line.";
  if (/context does not match/iu.test(message))
    return "Read only the affected symbol or short range, then submit a focused patch against the current text.";
  if (/too many (?:files|operations)/iu.test(message))
    return "Split the change into smaller atomic batches without repeating completed files.";
  return undefined;
}

type LightEditFailure = Exclude<LightToolResult<unknown>, { status: "ok" }>;

function commitFailure(error: unknown): LightEditFailure {
  if (error instanceof LightCommitConflict)
    return {
      status: "blocked",
      category: "input",
      message: error.message,
      diagnosticId: `edit-${Date.now().toString(36)}`,
    };
  return {
    status: "failed",
    category: "harness",
    message: errorMessage(error),
    diagnosticId: `edit-${Date.now().toString(36)}`,
  };
}

function isLightFailure(
  value: LightCommitResult | LightEditFailure,
): value is LightEditFailure {
  return "status" in value;
}

function parseSummary(files: FinalFile[]) {
  const statuses = files.map(({ parse }) => parse.status);
  const priority: LightParseStatus[] = [
    "failed",
    "unavailable",
    "degraded_preexisting_errors",
    "unsupported",
    "passed",
  ];
  return {
    status:
      priority.find((status) => statuses.includes(status)) ?? "unsupported",
    files: files.map(({ path, parse }) => ({
      path,
      status: parse.status,
      ...(parse.diagnostics.length ? { diagnostics: parse.diagnostics } : {}),
    })),
  };
}

function fileChange(file: FinalFile) {
  const before = file.initial?.toString("utf8") ?? "";
  const after = file.content?.toString("utf8") ?? "";
  return {
    path: file.path,
    additions: lineCount(after) - commonLineCount(before, after),
    deletions: lineCount(before) - commonLineCount(before, after),
    ...(file.symbols.length ? { symbols: [...new Set(file.symbols)] } : {}),
  };
}

function commonLineCount(left: string, right: string) {
  const rightCounts = new Map<string, number>();
  for (const line of right.split("\n"))
    rightCounts.set(line, (rightCounts.get(line) ?? 0) + 1);
  let count = 0;
  for (const line of left.split("\n")) {
    const available = rightCounts.get(line) ?? 0;
    if (!available) continue;
    count += 1;
    rightCounts.set(line, available - 1);
  }
  return count;
}

function lineCount(value: string) {
  return value ? value.split("\n").length : 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? String(error.code)
    : undefined;
}
