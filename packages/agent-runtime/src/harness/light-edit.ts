import { createTwoFilesPatch } from "diff";
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

type Replacement = { end: number; replacement: string; start: number };

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
  parse: LightParseStatus;
};

type LightParseStatus =
  | "passed"
  | "failed"
  | "unsupported"
  | "unavailable"
  | "degraded_preexisting_errors";

type EditContext = {
  sessionId?: string;
  toolCallId?: string;
};

type LightEditOptions = {
  files: WorkspaceFiles;
  journal: SessionJournal;
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
      const finalFiles = await this.finalize(plans);
      const invalid = finalFiles.find(({ parse }) => parse === "failed");
      if (invalid) return invalidParseResult(invalid);
      void context;
      const result: LightCommitResult | LightEditFailure = await this.commit(
        finalFiles,
        snapshot,
      ).catch(commitFailure);
      if (isLightFailure(result)) return result;
      return await this.mapResult(result, finalFiles, snapshot);
    } catch (error) {
      return editFailure(error);
    }
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
    const aliases = await this.refreshAliases(paths);
    await this.journal.recordAliases(this.aliases.entries());
    return appliedEditResult(receipt, files, aliases, parse, snapshot);
  }

  private async refreshAliases(paths: string[]) {
    const snapshot = await this.files.snapshot();
    const output: Array<{
      alias: string;
      path: string;
      qualifiedName: string;
    }> = [];
    for (const path of paths) {
      this.aliases.invalidatePath(path);
      const content = (await optionalFile(this.files, path))?.content;
      if (!content) continue;
      for (const symbol of parseCode(path, content).symbols.slice(0, 8)) {
        const { alias } = this.aliases.registerSymbol(
          path,
          content,
          symbol,
          snapshot.revision.source_revision_id,
        );
        output.push({ alias, path, qualifiedName: symbol.qualified_name });
      }
    }
    return output;
  }
}

function applyPatchPlan(
  file: PlannedFile,
  path: string,
  patch: Awaited<ReturnType<typeof planLightPatch>>,
) {
  if (patch.mode === "add") {
    if (file.initial) throw new Error(`${path} already exists.`);
    file.mutation = "add";
    file.replacements.push({ start: 0, end: 0, replacement: patch.content });
    return;
  }
  if (patch.mode === "delete") {
    if (!file.initial) throw new Error(`${path} does not exist.`);
    file.mutation = "delete";
    return;
  }
  file.replacements.push(...patch.replacements);
}

function appliedEditResult(
  receipt: string,
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
      aliases,
      parse,
      diff: compactDiff(files),
      basedOn: snapshot.git ? "worktree" : "filesystem",
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
  if (operation.action === "replace_body")
    return symbolBodyReplacement(resolved, operation.content);
  const range = syntaxBoundaryRange(
    resolved.path,
    resolved.content,
    resolved.symbol.range_utf8_bytes,
  );
  if (operation.action === "insert_before")
    return insertionReplacement(range[0], operation.content);
  if (operation.action === "insert_after")
    return insertionReplacement(range[1], operation.content);
  return wholeSymbolReplacement(resolved, operation, range);
}

function symbolBodyReplacement(
  resolved: ResolvedLightSymbol,
  content?: string,
): Replacement {
  const [start, end] = symbolEditRange(resolved.symbol, "body");
  return { start, end, replacement: content ?? "" };
}

function insertionReplacement(offset: number, content?: string): Replacement {
  return { start: offset, end: offset, replacement: content ?? "" };
}

function wholeSymbolReplacement(
  resolved: ResolvedLightSymbol,
  operation: Extract<
    LightEditCodeInput["operations"][number],
    { kind: "symbol" }
  >,
  range: [number, number],
): Replacement {
  return {
    start:
      operation.action === "replace"
        ? resolved.symbol.range_utf8_bytes[0]
        : range[0],
    end:
      operation.action === "replace"
        ? resolved.symbol.range_utf8_bytes[1]
        : range[1],
    replacement: operation.action === "delete" ? "" : (operation.content ?? ""),
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
    (left, right) => left.start - right.start,
  );
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.start < previous.end || sameInsertion(previous, current))
      throw new Error(`Edit operations overlap in ${file.path}.`);
  }
}

function sameInsertion(left: Replacement, right: Replacement) {
  return (
    left.start === left.end &&
    right.start === right.end &&
    left.start === right.start
  );
}

function applyPlan(plan: PlannedFile) {
  if (plan.mutation === "delete") return null;
  let content = plan.initial ?? Buffer.alloc(0);
  const descending = [...plan.replacements].sort(
    (left, right) => right.start - left.start,
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
): Promise<LightParseStatus> {
  if (!after) return "unsupported";
  const validation = await validateContent({
    content: after,
    externalValidation: path.endsWith(".prisma") ? "unsupported" : "enabled",
    path,
    workspaceRoot,
  });
  if (validation.status === "passed") return "passed";
  if (validation.status === "unsupported") return unsupportedStatus(path);
  return failedOrDegraded(path, before, after, validation);
}

function unsupportedStatus(path: string): LightParseStatus {
  return parseAvailability(path) === "unavailable"
    ? "unavailable"
    : "unsupported";
}

function failedOrDegraded(
  path: string,
  before: Buffer | null,
  after: Buffer,
  validation: ContentValidation,
): LightParseStatus {
  if (!before || validation.status !== "failed") return "failed";
  const previous = parseCode(path, before);
  const current = parseCode(path, after);
  return previous.supported && current.errorCount <= previous.errorCount
    ? "degraded_preexisting_errors"
    : "failed";
}

function invalidParseResult(file: FinalFile): LightToolResult<unknown> {
  return {
    status: "blocked",
    category: "code",
    message: `Final parse failed for ${file.path}; no files were written.`,
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
  return {
    status: "blocked",
    category: "input",
    message: errorMessage(error),
    diagnosticId,
  };
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
  const statuses = files.map(({ parse }) => parse);
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
    files: files.map(({ path, parse }) => ({ path, status: parse })),
  };
}

function fileChange(file: FinalFile) {
  const before = file.initial?.toString("utf8") ?? "";
  const after = file.content?.toString("utf8") ?? "";
  return {
    path: file.path,
    additions: lineCount(after) - commonLineCount(before, after),
    deletions: lineCount(before) - commonLineCount(before, after),
  };
}

function compactDiff(files: FinalFile[]) {
  const diff = files
    .map((file) =>
      createTwoFilesPatch(
        `a/${file.path}`,
        `b/${file.path}`,
        file.initial?.toString("utf8") ?? "",
        file.content?.toString("utf8") ?? "",
        undefined,
        undefined,
        { context: 3 },
      ),
    )
    .join("\n");
  return diff.length > 8_000 ? `${diff.slice(0, 8_000)}\n…` : diff;
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
