import type { AgentToolContext } from "@cline/sdk";
import { pythonBodyRange } from "./python-body.js";
import {
  outlineSymbol,
  parseCode,
  symbolEditRange,
  type ParsedSymbol,
} from "./code-intelligence.js";
import {
  LightAliasRegistry,
  SymbolResolutionError,
  type ResolvedLightSymbol,
} from "./light-aliases.js";
import {
  capabilityForPath,
  lightCapabilityDescription,
  runtimeCapabilityRegistry,
} from "./light-capabilities.js";
import type {
  LightEditCodeInput,
  LightReadCodeInput,
  LightRunTaskInput,
  LightSearchCodeInput,
  LightTaskContract,
  LightToolResult,
} from "./light-contracts.js";
import { LightEditService } from "./light-edit.js";
import { LightCommitService } from "./light-commit.js";
import {
  autoSearchResult,
  autoSymbolCandidates,
  editTargetSymbols,
  enclosingSymbol,
  firstTermIndex,
  lexicalQuery,
  lineRange,
  matchedTerm,
  outlineCandidates,
  pathMatches,
  qualifiedTarget,
  rankedTextMatches,
  recordValue,
  requestedLineRange,
  routedView,
  scopedCandidates,
  searchMode,
  searchSymbolResult,
  searchTerms,
  sourceLine,
  stringValue,
  symbolicPath,
  symbolMatches,
  symbolSearchResult,
  textSearchResult,
  uniqueSearchResults,
  type EditTarget,
  type SearchMode,
} from "./light-navigation.js";
import { LightTaskRunner } from "./light-task-runner.js";
import {
  searchWithRipgrep,
  type LexicalSearchMatch,
} from "./lexical-search.js";
import { ReadCoverage, type ByteInterval } from "./read-coverage.js";
import { SessionJournal } from "./session-journal.js";
import { sha256 } from "./light-identity.js";
import {
  assertMutableWorkspacePath,
  WorkspaceFiles,
} from "./workspace-files.js";

type LightWorkspaceOptions = {
  refreshPreviewDependencies?: () => Promise<unknown>;
  sessionId: string;
  taskContract?: LightTaskContract;
};

type ReadContext = Partial<AgentToolContext>;

const maximumRawCharacters = 64_000;
const maximumOutlineItems = 32;
const maximumDirectoryEntries = 64;

function outlineRangeCandidates(
  symbols: ParsedSymbol[],
  range?: LightReadCodeInput["range"],
) {
  const candidates = outlineCandidates(symbols);
  if (!range) return candidates;
  return candidates.filter(
    ({ line_range: [start, end] }) =>
      start <= range.endLine && end >= range.startLine,
  );
}

export class LightWorkspace {
  readonly edits: LightEditService;
  readonly tasks: LightTaskRunner;
  private readonly aliases = new LightAliasRegistry();
  private readonly coverage = new ReadCoverage();
  private readonly files: WorkspaceFiles;
  private readonly journal: SessionJournal;
  private initialization?: Promise<void>;
  private readonly options: LightWorkspaceOptions;
  private readonly commits: LightCommitService;

  constructor(workspaceRoot: string, options: LightWorkspaceOptions) {
    this.files = new WorkspaceFiles(workspaceRoot);
    this.commits = new LightCommitService(this.files);
    this.journal = new SessionJournal(workspaceRoot, options.sessionId);
    this.options = options;
    this.edits = new LightEditService(this.aliases, {
      files: this.files,
      journal: this.journal,
    });
    this.tasks = new LightTaskRunner({
      edits: this.edits,
      files: this.files,
      journal: this.journal,
      refreshPreviewDependencies: options.refreshPreviewDependencies,
    });
  }

  private get ready() {
    return (this.initialization ??= this.initializeJournal(this.options));
  }

  async editCode(
    input: LightEditCodeInput,
    context: {
      sessionId?: string;
      toolCallId?: string;
      signal?: AbortSignal;
    } = {},
  ) {
    await this.ready;
    const result = await this.edits.edit(input, context);
    if (result.status === "ok")
      for (const change of arrayValue(recordValue(result.data).changes)) {
        const path = stringValue(recordValue(change).path);
        if (path) this.coverage.invalidatePath(path);
      }
    await this.journal.recordCoverage(this.coverage.snapshot());
    return result;
  }

  async runTask(input: LightRunTaskInput, context: AgentToolContext) {
    await this.ready;
    const result = await this.tasks.run(input, context);
    if (result.status !== "ok") return result;
    const paths = arrayValue(recordValue(result.data).paths).flatMap(
      (value) => {
        const path = stringValue(value);
        return path ? [path] : [];
      },
    );
    for (const path of paths) this.coverage.invalidatePath(path);
    if (paths.length)
      await this.journal.recordCoverage(this.coverage.snapshot());
    return result;
  }

  async searchCode(
    input: LightSearchCodeInput,
    signal?: AbortSignal,
  ): Promise<LightToolResult<unknown>> {
    try {
      await this.ready;
      return await this.commits.exclusive(() =>
        this.searchCurrentWorkspace(input, signal),
      );
    } catch (error) {
      return inputBlocked(error);
    }
  }

  private async searchCurrentWorkspace(
    input: LightSearchCodeInput,
    signal?: AbortSignal,
  ) {
    const snapshot = await this.files.snapshot(signal);
    const candidates = scopedCandidates(
      this.files,
      snapshot.files,
      input.scope,
    );
    const result = await this.searchResult(
      input,
      searchMode(input),
      candidates,
      snapshot.revision.source_revision_id,
      signal,
    );
    return this.persistAliases(result);
  }

  async readCode(
    input: LightReadCodeInput,
    context: ReadContext,
  ): Promise<LightToolResult<unknown>> {
    try {
      await this.ready;
      return await this.commits.exclusive(() =>
        this.readCurrentWorkspace(input, context),
      );
    } catch (error) {
      return inputBlocked(error);
    }
  }

  private async readCurrentWorkspace(
    input: LightReadCodeInput,
    context: ReadContext,
  ) {
    context.signal?.throwIfAborted();
    const special = this.specialReadResult(input.target);
    if (special) return special;
    const snapshot = await this.files.snapshot(context.signal);
    const directory = await this.directoryReadResult(
      input,
      snapshot.files,
      context,
    );
    return (
      directory ??
      this.readWorkspaceTarget(
        input,
        snapshot.revision.source_revision_id,
        context,
      )
    );
  }

  private async initializeJournal(options: LightWorkspaceOptions) {
    await this.commits.exclusive(() => this.journal.hydrate());
    this.aliases.hydrate(this.journal.currentAliases());
    this.coverage.hydrate(this.journal.currentCoverage());
    const objective = options.taskContract?.objective;
    if (objective) await this.journal.ingestUserRequest("initial", objective);
  }

  private async persistAliases<T>(result: LightToolResult<T>) {
    await this.journal.recordAliases(this.aliases.entries());
    return result;
  }

  private async searchResult(
    input: LightSearchCodeInput,
    mode: SearchMode,
    candidates: string[],
    revision: string,
    signal?: AbortSignal,
  ): Promise<LightToolResult<unknown>> {
    if (mode === "symbol" && input.mode === "symbol")
      return symbolSearchResult(
        await this.symbolSearch(input.query, candidates, revision, signal),
        candidates,
      );
    const text = await this.textSearch(
      input.query,
      candidates,
      revision,
      input.mode !== "text",
      signal,
    );
    if (mode !== "symbol") return textSearchResult(mode, text, candidates);
    const symbolCandidates = autoSymbolCandidates(
      text,
      candidates,
      input.query,
    );
    const symbols = await this.symbolSearch(
      input.query,
      symbolCandidates,
      revision,
      signal,
    );
    return autoSearchResult(symbols, text, candidates);
  }

  private specialReadResult(target: string) {
    if (target === "@capabilities") return capabilitiesResult();
    if (target === "@changes")
      return {
        status: "ok" as const,
        data: { changes: this.journal.currentChanges() },
      };
    return undefined;
  }

  private async directoryReadResult(
    input: LightReadCodeInput,
    files: string[],
    context: ReadContext,
  ): Promise<LightToolResult<unknown> | undefined> {
    if (this.aliases.get(input.target) || qualifiedTarget(input.target))
      return undefined;
    const path = this.files.normalizePath(input.target);
    assertMutableWorkspacePath(path);
    if (!(await this.files.pathProfile(path)).directory) return undefined;
    const entries = directoryEntries(path, files);
    const content = Buffer.from(JSON.stringify(entries));
    const coverage = await this.registerCoverage(
      `${path}/`,
      content,
      [[0, content.byteLength]],
      context,
    );
    if (coverage.covered)
      return coveredDirectoryResult(path, coverage.receipt);
    return {
      status: "ok",
      receipt: coverage.receipt,
      data: {
        candidateCount: entries.length,
        entries: entries.slice(0, maximumDirectoryEntries),
        path,
        truncated: entries.length > maximumDirectoryEntries,
        view: "directory",
      },
    };
  }

  private async readWorkspaceTarget(
    input: LightReadCodeInput,
    revision: string,
    context: ReadContext,
  ) {
    const alias = this.aliases.get(input.target);
    const result =
      alias?.kind === "path"
        ? await this.readPath(
            { ...input, target: alias.path },
            revision,
            context,
          )
        : alias?.kind === "range"
          ? await this.readRangeAlias(alias, input, revision, context)
          : alias?.kind === "symbol" || qualifiedTarget(input.target)
            ? await this.readSymbol(input.target, revision, context, input)
            : await this.readPath(input, revision, context);
    return this.persistAliases(result);
  }

  private async symbolSearch(
    query: string,
    candidates: string[],
    revision: string,
    signal?: AbortSignal,
  ) {
    const results: unknown[] = [];
    const normalized = query.toLocaleLowerCase();
    for (const path of candidates) {
      signal?.throwIfAborted();
      if (results.length >= 8 || !symbolicPath(path)) continue;
      const content = (await this.files.read(path)).content;
      if (content.byteLength > 2 * 1024 * 1024) continue;
      for (const symbol of parseCode(path, content).symbols) {
        if (!symbolMatches(symbol, normalized)) continue;
        const { alias, materialized } = this.aliases.registerSymbol(
          path,
          content,
          symbol,
          revision,
        );
        results.push(searchSymbolResult(alias, path, materialized));
        if (results.length >= 8) break;
      }
    }
    return results;
  }

  private async textSearch(
    query: string,
    candidates: string[],
    revision: string,
    promoteSymbols: boolean,
    signal?: AbortSignal,
  ) {
    const paths = this.pathSearch(query, candidates);
    const searched = await searchWithRipgrep({
      candidates,
      maximum: 32,
      query: lexicalQuery(query),
      root: this.files.root,
      signal,
    });
    if (!searched.available)
      return uniqueSearchResults([
        ...paths,
        ...(await this.nodeTextSearch(query, candidates)),
      ]).slice(0, 8);
    const matches = rankedTextMatches(searched.items, query).slice(0, 8);
    const content = await Promise.all(
      matches.map((match) => this.textMatch(match, revision, promoteSymbols)),
    );
    return uniqueSearchResults([...paths, ...content]).slice(0, 8);
  }

  private pathSearch(query: string, candidates: string[]) {
    return pathMatches(query, candidates).map((path) => ({
      alias: this.aliases.registerPath(path),
      kind: "path",
      path,
      reason: "path_name",
      target: path,
    }));
  }

  private async textMatch(
    match: LexicalSearchMatch,
    revision: string,
    promoteSymbols: boolean,
  ) {
    const content = (await this.files.read(match.path)).content;
    const symbol = promoteSymbols
      ? enclosingSymbol(
          parseCode(match.path, content).symbols,
          match.range_utf8_bytes,
        )
      : undefined;
    if (symbol) {
      const { alias, materialized } = this.aliases.registerSymbol(
        match.path,
        content,
        symbol,
        revision,
      );
      return searchSymbolResult(
        alias,
        match.path,
        materialized,
        "lexical_symbol",
      );
    }
    const alias = this.aliases.registerRange(
      match.path,
      content,
      match.range_utf8_bytes,
    );
    return {
      alias,
      kind: "text",
      path: match.path,
      lines: match.line_range,
      snippet: match.excerpt,
      reason: match.match_reason,
    };
  }

  private async nodeTextSearch(query: string, candidates: string[]) {
    const results: unknown[] = [];
    const terms = searchTerms(query);
    for (const path of candidates) {
      if (results.length >= 8) break;
      const content = (await this.files.read(path)).content;
      const source = content.toString("utf8");
      const index = firstTermIndex(source, terms, query);
      if (index < 0) continue;
      const matched = matchedTerm(source, index, terms, query);
      const start = Buffer.byteLength(source.slice(0, index));
      const range: [number, number] = [
        start,
        start + Buffer.byteLength(matched),
      ];
      results.push({
        alias: this.aliases.registerRange(path, content, range),
        kind: "text",
        path,
        lines: lineRange(content, range),
        snippet: sourceLine(source, index),
        reason: terms.length > 1 ? "lexical_regex" : "lexical_exact",
      });
    }
    return results;
  }

  private async readPath(
    input: LightReadCodeInput,
    revision: string,
    context: ReadContext,
  ): Promise<LightToolResult<unknown>> {
    const path = this.files.normalizePath(input.target);
    assertMutableWorkspacePath(path);
    const file = await this.files.read(path);
    const source = file.content.toString("utf8");
    const view = routedView(input, path, source.length);
    if (view === "outline")
      return await this.readOutlinePath(
        path,
        file.content,
        revision,
        context,
        input.range,
      );
    if (view === "range")
      return await this.readLineRange(
        path,
        file.content,
        input,
        revision,
        context,
      );
    return await this.raw(
      path,
      file.content,
      revision,
      context,
      view === "symbol" ? "symbol_target_missing" : undefined,
    );
  }

  private async readOutlinePath(
    path: string,
    content: Buffer,
    revision: string,
    context: ReadContext,
    range?: LightReadCodeInput["range"],
  ) {
    const parsed = parseCode(path, content);
    if (parsed.supported)
      return await this.outline(
        path,
        content,
        parsed.symbols,
        revision,
        context,
        range,
      );
    return await this.raw(
      path,
      content,
      revision,
      context,
      "symbol_view_unavailable",
    );
  }

  private async readLineRange(
    path: string,
    content: Buffer,
    input: LightReadCodeInput,
    revision: string,
    context: ReadContext,
  ) {
    if (!input.range) throw new Error("range is required for the range view.");
    const range = lineByteRange(
      content,
      input.range.startLine,
      input.range.endLine,
    );
    const editTargets = this.registerEditTargets(path, content, revision, [
      range,
    ]);
    return await this.coveredContent(
      path,
      content,
      [range],
      context,
      "range",
      undefined,
      false,
      editTargets,
    );
  }

  private async outline(
    path: string,
    content: Buffer,
    symbols: ParsedSymbol[],
    revision: string,
    context: ReadContext,
    range?: LightReadCodeInput["range"],
  ): Promise<LightToolResult<unknown>> {
    const projection = await this.prepareOutline(
      path,
      content,
      symbols,
      revision,
      context,
      range,
    );
    if (!projection) return emptyOutline(path);
    const { candidates, coverage, editTargets, selected } = projection;
    const items = this.outlineItems(path, content, selected, revision);
    return outlineResult(
      path,
      items,
      candidates.length,
      coverage.receipt,
      editTargets,
    );
  }

  private async prepareOutline(
    path: string,
    content: Buffer,
    symbols: ParsedSymbol[],
    revision: string,
    context: ReadContext,
    range?: LightReadCodeInput["range"],
  ) {
    const candidates = outlineRangeCandidates(symbols, range);
    const selected = candidates.slice(0, maximumOutlineItems);
    if (!selected.length) return undefined;
    const interval = range
      ? lineByteRange(content, range.startLine, range.endLine)
      : undefined;
    const editTargets = this.registerEditTargets(
      path,
      content,
      revision,
      interval ? [interval] : undefined,
    );
    const coverage = await this.registerCoverage(
      path,
      content,
      selected.map(signatureRange),
      context,
    );
    return { candidates, coverage, editTargets, selected };
  }

  private outlineItems(
    path: string,
    content: Buffer,
    symbols: ParsedSymbol[],
    revision: string,
  ) {
    const registered = symbols.map((symbol) => {
      const { alias, materialized } = this.aliases.registerSymbol(
        path,
        content,
        symbol,
        revision,
      );
      return { alias, materialized, symbol };
    });
    return registered.map(({ alias, materialized, symbol }) => {
      const parent = enclosingOutlineTarget(symbol, registered);
      return {
        alias,
        ...outlineSymbol(materialized),
        ...(parent ? { containedBy: parent.alias } : {}),
      };
    });
  }

  private async readSymbol(
    target: string,
    revision: string,
    context: ReadContext,
    input: LightReadCodeInput = { target },
  ): Promise<LightToolResult<unknown>> {
    const resolved = await this.resolveReadSymbol(target, revision);
    if (requestedLineRange(input))
      return this.readLineRange(resolved.path, resolved.content, input, revision, context);
    if (input.view === "outline")
      return this.symbolOutline(resolved, revision, context);
    const { signature, body, imports, coverage } = await this.symbolProjection(
      resolved,
      context,
    );
    return symbolContentResult(
      resolved,
      signature,
      body,
      imports,
      [signature, body, ...coverage.uncovered],
      coverage.receipt,
    );
  }

  private async resolveReadSymbol(target: string, revision: string) {
    const candidate = await this.aliases.resolveSymbol(
      target,
      this.files,
      revision,
    );
    const registered = this.aliases.registerSymbol(
      candidate.path,
      candidate.content,
      candidate.symbol,
      revision,
    );
    return {
      ...candidate,
      alias: registered.alias,
      materialized: registered.materialized,
    };
  }

  private async symbolOutline(
    resolved: ResolvedLightSymbol,
    revision: string,
    context: ReadContext,
  ) {
    const [start, end] = resolved.symbol.range_utf8_bytes;
    const symbols = parseCode(resolved.path, resolved.content).symbols.filter(
      ({ range_utf8_bytes: range }) => range[0] >= start && range[1] <= end,
    );
    const [startLine, endLine] = resolved.symbol.line_range;
    return this.outline(
      resolved.path,
      resolved.content,
      symbols,
      revision,
      context,
      { startLine, endLine },
    );
  }

  private async symbolProjection(
    resolved: ResolvedLightSymbol,
    context: ReadContext,
  ) {
    const signature = symbolEditRange(resolved.symbol, "signature");
    const range = symbolEditRange(resolved.symbol, "body");
    const body =
      capabilityForPath(resolved.path)?.language === "python"
        ? pythonBodyRange(resolved.content, range)
        : range;
    const imports = shortImportBlock(resolved.content.toString("utf8"));
    const coverage = await this.registerCoverage(
      resolved.path,
      resolved.content,
      [signature, body, ...(imports ? [imports.range] : [])],
      context,
    );
    return { signature, body, imports, coverage };
  }

  private async readRangeAlias(
    alias: Extract<
      NonNullable<ReturnType<LightAliasRegistry["get"]>>,
      { kind: "range" }
    >,
    input: LightReadCodeInput,
    revision: string,
    context: ReadContext,
  ) {
    const content = (await this.files.read(alias.path)).content;
    if (sha256(content) !== alias.fileHash)
      throw new Error(
        `${alias.alias} is stale and cannot be relocated as text.`,
      );
    if (requestedLineRange(input))
      return this.readLineRange(alias.path, content, input, revision, context);
    if (input.view === "symbol") {
      const symbol = enclosingSymbol(parseCode(alias.path, content).symbols, [
        alias.start,
        alias.end,
      ]);
      if (symbol) {
        const registered = this.aliases.registerSymbol(
          alias.path,
          content,
          symbol,
          revision,
        );
        return this.readSymbol(registered.alias, revision, context);
      }
    }
    const intervals: ByteInterval[] = [[alias.start, alias.end]];
    const editTargets = this.registerEditTargets(
      alias.path,
      content,
      revision,
      intervals,
    );
    return await this.coveredContent(
      alias.path,
      content,
      intervals,
      context,
      "range",
      undefined,
      false,
      editTargets,
    );
  }

  private async raw(
    path: string,
    content: Buffer,
    revision: string,
    context: ReadContext,
    fallbackReason?: string,
  ) {
    const end = Math.min(content.byteLength, maximumRawCharacters);
    const editTargets = this.registerEditTargets(path, content, revision);
    return await this.coveredContent(
      path,
      content,
      [[0, end]],
      context,
      "raw",
      fallbackReason,
      content.byteLength > end,
      editTargets,
    );
  }

  private async coveredContent(
    path: string,
    content: Buffer,
    intervals: ByteInterval[],
    context: ReadContext,
    view: "range" | "raw",
    fallbackReason?: string,
    truncated = false,
    editTargets: EditTarget[] = [],
  ): Promise<LightToolResult<unknown>> {
    const coverage = await this.registerCoverage(
      path,
      content,
      intervals,
      context,
    );
    return contentResult(
      path,
      content,
      intervals,
      view,
      coverage.receipt,
      fallbackReason,
      truncated,
      editTargets,
    );
  }

  private registerEditTargets(
    path: string,
    content: Buffer,
    revision: string,
    intervals?: ByteInterval[],
  ) {
    if (content.byteLength > 2 * 1024 * 1024) return [];
    const parsed = parseCode(path, content);
    if (!parsed.supported) return [];
    return editTargetSymbols(parsed.symbols, intervals).map((symbol) => {
      const { alias, materialized } = this.aliases.registerSymbol(
        path,
        content,
        symbol,
        revision,
      );
      return { alias, qualifiedName: materialized.qualified_name };
    });
  }

  private async registerCoverage(
    path: string,
    content: Buffer,
    intervals: ByteInterval[],
    context: ReadContext,
  ) {
    const result = this.coverage.register({
      consumerId:
        context.agentId ||
        context.conversationId ||
        context.sessionId ||
        "lead",
      generation: contextGeneration(context),
      hash: sha256(content),
      intervals,
      path,
    });
    await this.journal.recordCoverage(this.coverage.snapshot());
    return result;
  }
}

function enclosingOutlineTarget(
  symbol: ParsedSymbol,
  candidates: Array<{ alias: string; symbol: ParsedSymbol }>,
) {
  return candidates
    .filter(
      ({ symbol: candidate }) =>
        candidate !== symbol &&
        candidate.range_utf8_bytes[0] <= symbol.range_utf8_bytes[0] &&
        candidate.range_utf8_bytes[1] >= symbol.range_utf8_bytes[1],
    )
    .sort(
      (left, right) => byteLength(left.symbol) - byteLength(right.symbol),
    )[0];
}

function byteLength(symbol: ParsedSymbol) {
  return symbol.range_utf8_bytes[1] - symbol.range_utf8_bytes[0];
}

function emptyOutline(path: string): LightToolResult<unknown> {
  return {
    status: "ok",
    data: { path, view: "outline", items: [], truncated: false },
  };
}

function directoryEntries(path: string, files: string[]) {
  const prefix = path === "." ? "" : `${path}/`;
  const entries = new Map<string, "directory" | "file">();
  for (const file of files) {
    if (!file.startsWith(prefix)) continue;
    const [name, ...descendants] = file.slice(prefix.length).split("/");
    if (!name) continue;
    const child = `${prefix}${name}`;
    entries.set(child, descendants.length ? "directory" : "file");
  }
  return [...entries]
    .map(([target, kind]) => ({ kind, target }))
    .sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) ||
        left.target.localeCompare(right.target),
    );
}

function coveredDirectoryResult(
  path: string,
  receipt: string,
): LightToolResult<unknown> {
  return {
    status: "ok",
    data: {
      status: "already_in_context",
      target: path,
      path,
      view: "directory",
    },
    receipt,
  };
}

function outlineResult(
  path: string,
  items: unknown[],
  total: number,
  receipt: string,
  editTargets: EditTarget[],
): LightToolResult<unknown> {
  return {
    status: "ok",
    receipt,
    data: {
      path,
      view: "outline",
      items,
      editTargets,
      truncated: total > items.length,
    },
  };
}

function symbolContentResult(
  resolved: ResolvedLightSymbol,
  signature: ByteInterval,
  body: ByteInterval,
  imports: ReturnType<typeof shortImportBlock>,
  uncovered: ByteInterval[],
  receipt: string,
): LightToolResult<unknown> {
  return {
    status: "ok",
    receipt,
    data: {
      path: resolved.path,
      view: "symbol",
      alias: resolved.alias,
      editTarget: resolved.alias,
      kind: resolved.materialized.kind,
      qualifiedName: resolved.materialized.qualified_name,
      ...symbolProjectedContent(resolved, signature, body, imports, uncovered),
    },
  };
}

function symbolProjectedContent(
  resolved: ResolvedLightSymbol,
  signature: ByteInterval,
  body: ByteInterval,
  imports: ReturnType<typeof shortImportBlock>,
  uncovered: ByteInterval[],
) {
  return {
    ...(rangeHasDelta(signature, uncovered)
      ? { signature: resolved.materialized.signature }
      : {}),
    ...(rangeHasDelta(body, uncovered)
      ? { body: resolved.content.subarray(...body).toString("utf8") }
      : {}),
    ...(imports && rangeHasDelta(imports.range, uncovered)
      ? { imports: imports.content }
      : {}),
  };
}

function contentResult(
  path: string,
  content: Buffer,
  intervals: ByteInterval[],
  view: "range" | "raw",
  receipt: string,
  fallbackReason?: string,
  truncated = false,
  editTargets: EditTarget[] = [],
): LightToolResult<unknown> {
  const segments = intervals.map(([start, end]) => ({
    range: [start, end],
    content: content.subarray(start, end).toString("utf8"),
  }));
  const projected =
    segments.length === 1 ? { content: segments[0]!.content } : { segments };
  return {
    status: "ok",
    receipt,
    data: {
      path,
      view,
      complete:
        intervals.length === 1 &&
        intervals[0]![0] === 0 &&
        intervals[0]![1] === content.byteLength,
      ...(fallbackReason ? { fallbackReason } : {}),
      ...(editTargets.length ? { editTargets } : {}),
      ...projected,
      truncated,
    },
  };
}

function signatureRange(symbol: ParsedSymbol): ByteInterval {
  return symbolEditRange(symbol, "signature");
}

function rangesOverlap(left: ByteInterval, right: ByteInterval) {
  return left[0] < right[1] && right[0] < left[1];
}

function rangeHasDelta(range: ByteInterval, uncovered: ByteInterval[]) {
  return uncovered.some((candidate) => rangesOverlap(range, candidate));
}

function capabilitiesResult(): LightToolResult<unknown> {
  return {
    status: "ok",
    data: {
      description: lightCapabilityDescription(),
      languages: runtimeCapabilityRegistry(),
    },
  };
}

function lineByteRange(
  content: Buffer,
  startLine: number,
  endLine: number,
): [number, number] {
  const lines = content.toString("utf8").split(/(?<=\n)/u);
  if (startLine > lines.length)
    throw new Error("Range starts after the end of the file.");
  const start = Buffer.byteLength(lines.slice(0, startLine - 1).join(""));
  const end = Buffer.byteLength(
    lines.slice(0, Math.min(endLine, lines.length)).join(""),
  );
  return [start, end];
}

function shortImportBlock(source: string) {
  const expression =
    /^\s*(?:import\b|from\b|use\b|package\b|using\b|#include\b)/u;
  const lines = source.split(/(?<=\n)/u).slice(0, 40);
  const offsets = lines.reduce<number[]>((values, line) => {
    values.push((values.at(-1) ?? 0) + line.length);
    return values;
  }, []);
  const selected = lines.flatMap((line, index) =>
    expression.test(line) ? [index] : [],
  );
  if (!selected.length) return undefined;
  const start = selected[0] === 0 ? 0 : offsets[selected[0]! - 1]!;
  const end = offsets[selected.at(-1)!]!;
  const content = source.slice(start, end);
  if (content.length > 2_000) return undefined;
  return {
    content,
    range: [
      Buffer.byteLength(source.slice(0, start)),
      Buffer.byteLength(source.slice(0, end)),
    ] as ByteInterval,
  };
}

function contextGeneration(context: ReadContext) {
  const metadata = context.metadata ?? {};
  const generation = metadata.contextGeneration ?? metadata.contextEpoch;
  if (typeof generation === "string" || typeof generation === "number")
    return String(generation);
  const summary = [...(context.snapshot?.messages ?? [])]
    .reverse()
    .find((message) => message.metadata?.kind === "compaction_summary");
  return summary ? `compaction:${summary.id}` : "initial";
}

function inputBlocked(error: unknown): LightToolResult<unknown> {
  const diagnosticId = `read-${Date.now().toString(36)}`;
  const message = error instanceof Error ? error.message : String(error);
  const recovery =
    error instanceof SymbolResolutionError && error.candidates.length
      ? JSON.stringify(error.candidates)
      : undefined;
  return {
    status: "blocked",
    category: "input",
    message,
    diagnosticId,
    ...(recovery ? { recovery } : {}),
  };
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}
