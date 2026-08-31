import type { AgentToolContext } from "@cline/sdk";
import {
  materializeSymbol,
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

type ReadContext = Partial<
  Pick<
    AgentToolContext,
    "agentId" | "conversationId" | "metadata" | "sessionId" | "snapshot"
  >
>;

const smallFileCharacters = 16_000;
const maximumRawCharacters = 64_000;
type SearchMode = "references" | "symbol" | "text";

export class LightWorkspace {
  readonly edits: LightEditService;
  readonly tasks: LightTaskRunner;
  private readonly aliases = new LightAliasRegistry();
  private readonly coverage = new ReadCoverage();
  private readonly files: WorkspaceFiles;
  private readonly journal: SessionJournal;
  private readonly ready: Promise<void>;

  constructor(workspaceRoot: string, options: LightWorkspaceOptions) {
    this.files = new WorkspaceFiles(workspaceRoot);
    this.journal = new SessionJournal(workspaceRoot, options.sessionId);
    this.ready = this.initializeJournal(options);
    this.edits = new LightEditService(this.aliases, {
      files: this.files,
      journal: this.journal,
    });
    this.tasks = new LightTaskRunner({
      files: this.files,
      journal: this.journal,
      refreshPreviewDependencies: options.refreshPreviewDependencies,
    });
  }

  async editCode(
    input: LightEditCodeInput,
    context: { sessionId?: string; toolCallId?: string } = {},
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
    return this.tasks.run(input, context);
  }

  async searchCode(
    input: LightSearchCodeInput,
    signal?: AbortSignal,
  ): Promise<LightToolResult<unknown>> {
    try {
      await this.ready;
      const snapshot = await this.files.snapshot(signal);
      const candidates = scopedCandidates(
        this.files,
        snapshot.files,
        input.scope,
      );
      const mode = searchMode(input);
      const result = await this.searchResult(
        input,
        mode,
        candidates,
        snapshot.revision.source_revision_id,
        signal,
      );
      return this.persistAliases(result);
    } catch (error) {
      return inputBlocked(error);
    }
  }

  async readCode(
    input: LightReadCodeInput,
    context: ReadContext,
  ): Promise<LightToolResult<unknown>> {
    try {
      await this.ready;
      const special = this.specialReadResult(input.target);
      if (special) return special;
      const snapshot = await this.files.snapshot();
      return this.readWorkspaceTarget(
        input,
        snapshot.revision.source_revision_id,
        context,
      );
    } catch (error) {
      return inputBlocked(error);
    }
  }

  private async initializeJournal(options: LightWorkspaceOptions) {
    await this.journal.hydrate();
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
    const text = await this.textSearch(input.query, candidates, signal);
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

  private async readWorkspaceTarget(
    input: LightReadCodeInput,
    revision: string,
    context: ReadContext,
  ) {
    const alias = this.aliases.get(input.target);
    if (alias?.kind === "range") return this.readRangeAlias(alias, context);
    const result =
      alias?.kind === "symbol" || qualifiedTarget(input.target)
        ? await this.readSymbol(input.target, revision, context)
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
    signal?: AbortSignal,
  ) {
    const searched = await searchWithRipgrep({
      candidates,
      maximum: 32,
      query: lexicalQuery(query),
      root: this.files.root,
      signal,
    });
    if (!searched.available) return this.nodeTextSearch(query, candidates);
    const matches = rankedTextMatches(searched.items, query).slice(0, 8);
    return Promise.all(matches.map((match) => this.textMatch(match)));
  }

  private async textMatch(match: LexicalSearchMatch) {
    const content = (await this.files.read(match.path)).content;
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
      return await this.readOutlinePath(path, file.content, revision, context);
    if (view === "range")
      return await this.readLineRange(path, file.content, input, context);
    return await this.raw(
      path,
      file.content,
      context,
      view === "symbol" ? "symbol_target_missing" : undefined,
    );
  }

  private async readOutlinePath(
    path: string,
    content: Buffer,
    revision: string,
    context: ReadContext,
  ) {
    const parsed = parseCode(path, content);
    if (parsed.supported)
      return await this.outline(
        path,
        content,
        parsed.symbols,
        revision,
        context,
      );
    return await this.raw(path, content, context, "symbol_view_unavailable");
  }

  private async readLineRange(
    path: string,
    content: Buffer,
    input: LightReadCodeInput,
    context: ReadContext,
  ) {
    if (!input.range) throw new Error("range is required for the range view.");
    const range = lineByteRange(
      content,
      input.range.startLine,
      input.range.endLine,
    );
    return await this.coveredContent(path, content, [range], context, "range");
  }

  private async outline(
    path: string,
    content: Buffer,
    symbols: ParsedSymbol[],
    revision: string,
    context: ReadContext,
  ): Promise<LightToolResult<unknown>> {
    const selected = symbols.slice(0, 80);
    if (!selected.length) return emptyOutline(path);
    const coverage = await this.registerCoverage(
      path,
      content,
      selected.map(signatureRange),
      context,
    );
    if (coverage.covered)
      return alreadyCoveredResult(path, "outline", coverage.receipt);
    const items = this.outlineItems(
      path,
      content,
      selected,
      revision,
      coverage.uncovered,
    );
    return outlineResult(path, items, symbols.length, coverage.receipt);
  }

  private outlineItems(
    path: string,
    content: Buffer,
    symbols: ParsedSymbol[],
    revision: string,
    uncovered: ByteInterval[],
  ) {
    const visible = symbols.filter((symbol) =>
      uncovered.some((range) => rangesOverlap(range, signatureRange(symbol))),
    );
    return visible.map((symbol) => {
      const { alias, materialized } = this.aliases.registerSymbol(
        path,
        content,
        symbol,
        revision,
      );
      return { alias, ...outlineSymbol(materialized) };
    });
  }

  private async readSymbol(
    target: string,
    revision: string,
    context: ReadContext,
  ): Promise<LightToolResult<unknown>> {
    const resolved = await this.aliases.resolveSymbol(
      target,
      this.files,
      revision,
    );
    const { signature, body, imports, coverage } = await this.symbolProjection(
      resolved,
      context,
    );
    if (coverage.covered)
      return alreadyCoveredResult(
        resolved.path,
        "symbol",
        coverage.receipt,
        target,
      );
    return symbolContentResult(
      resolved,
      signature,
      body,
      imports,
      coverage.uncovered,
      coverage.receipt,
    );
  }

  private async symbolProjection(
    resolved: ResolvedLightSymbol,
    context: ReadContext,
  ) {
    const signature = symbolEditRange(resolved.symbol, "signature");
    const body = symbolEditRange(resolved.symbol, "body");
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
    context: ReadContext,
  ) {
    const content = (await this.files.read(alias.path)).content;
    if (sha256(content) !== alias.fileHash)
      throw new Error(
        `${alias.alias} is stale and cannot be relocated as text.`,
      );
    return await this.coveredContent(
      alias.path,
      content,
      [[alias.start, alias.end]],
      context,
      "range",
    );
  }

  private async raw(
    path: string,
    content: Buffer,
    context: ReadContext,
    fallbackReason?: string,
  ) {
    const end = Math.min(content.byteLength, maximumRawCharacters);
    return await this.coveredContent(
      path,
      content,
      [[0, end]],
      context,
      "raw",
      fallbackReason,
      content.byteLength > end,
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
  ): Promise<LightToolResult<unknown>> {
    const coverage = await this.registerCoverage(
      path,
      content,
      intervals,
      context,
    );
    if (coverage.covered)
      return alreadyCoveredResult(path, view, coverage.receipt);
    return uncoveredContentResult(
      path,
      content,
      coverage.uncovered,
      view,
      coverage.receipt,
      fallbackReason,
      truncated,
    );
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

function emptyOutline(path: string): LightToolResult<unknown> {
  return {
    status: "ok",
    data: { path, view: "outline", items: [], truncated: false },
  };
}

function alreadyCoveredResult(
  path: string,
  view: "outline" | "range" | "raw" | "symbol",
  receipt: string,
  target = path,
): LightToolResult<unknown> {
  return {
    status: "ok",
    data: { status: "already_in_context", target, path, view },
    receipt,
  };
}

function outlineResult(
  path: string,
  items: unknown[],
  total: number,
  receipt: string,
): LightToolResult<unknown> {
  return {
    status: "ok",
    receipt,
    data: { path, view: "outline", items, truncated: total > items.length },
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

function uncoveredContentResult(
  path: string,
  content: Buffer,
  intervals: ByteInterval[],
  view: "range" | "raw",
  receipt: string,
  fallbackReason?: string,
  truncated = false,
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
      ...(fallbackReason ? { fallbackReason } : {}),
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

function searchMode(input: LightSearchCodeInput): SearchMode {
  if (input.mode === "references") return "references";
  if (input.mode && input.mode !== "auto") return input.mode;
  return /^[\p{L}_$][\p{L}\p{N}_$.-]*$/u.test(input.query) ? "symbol" : "text";
}

function symbolSearchResult(results: unknown[], candidates: string[]) {
  return searchResult("symbol", "syntax", results, candidates);
}

function textSearchResult(
  mode: Exclude<SearchMode, "symbol">,
  results: unknown[],
  candidates: string[],
) {
  const engine = mode === "references" ? "lexical_fallback" : "ripgrep";
  return searchResult(mode, engine, results, candidates);
}

function autoSearchResult(
  symbols: unknown[],
  text: unknown[],
  candidates: string[],
) {
  const results = uniqueSearchResults([...symbols.slice(0, 4), ...text]);
  return searchResult(
    "auto",
    "syntax_and_ripgrep",
    results.slice(0, 8),
    candidates,
  );
}

function searchResult(
  mode: string,
  engine: string,
  results: unknown[],
  candidates: string[],
): LightToolResult<unknown> {
  return {
    status: "ok",
    data: {
      mode,
      engine,
      results,
      candidateCount: candidates.length,
      ...(results.length
        ? {}
        : { guidance: "No match in the selected scope." }),
    },
  };
}

function uniqueSearchResults(results: unknown[]) {
  const seen = new Set<string>();
  return results.filter((value) => {
    const result = recordValue(value);
    const key = `${result.path}:${result.qualifiedName ?? result.lines}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function autoSymbolCandidates(
  textResults: unknown[],
  candidates: string[],
  query: string,
) {
  const matchingPaths = new Set(
    textResults.flatMap((value) => {
      const path = stringValue(recordValue(value).path);
      return path ? [path] : [];
    }),
  );
  if (matchingPaths.size)
    return candidates.filter((path) => matchingPaths.has(path));
  return query.includes(".") ? candidates : [];
}

function scopedCandidates(
  files: WorkspaceFiles,
  paths: string[],
  scope?: string | string[],
) {
  const values = typeof scope === "string" ? [scope] : scope;
  if (!values?.length) return paths;
  const matchers = values.map((value) => scopeMatcher(files, value));
  return paths.filter((path) => matchers.some((matches) => matches(path)));
}

function scopeMatcher(files: WorkspaceFiles, value: string) {
  const portable = safeScopePattern(value);
  if (/[?*]/u.test(portable)) {
    const expression = globExpression(portable);
    return (path: string) => expression.test(path);
  }
  const root = files.normalizePath(portable);
  if (root === ".") return () => true;
  return (path: string) => path === root || path.startsWith(`${root}/`);
}

function safeScopePattern(value: string) {
  const portable = value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
  if (!portable || portable.startsWith("/") || /^[A-Za-z]:\//u.test(portable))
    throw new Error("Search scopes must be workspace-relative paths or globs.");
  if (portable.split("/").includes(".."))
    throw new Error("Search scope escapes the workspace root.");
  return portable;
}

function globExpression(pattern: string) {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!;
    if (character === "*" && pattern[index + 1] === "*") {
      const followedBySlash = pattern[index + 2] === "/";
      source += followedBySlash ? "(?:.*/)?" : ".*";
      index += followedBySlash ? 2 : 1;
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += escapeRegex(character);
  }
  return new RegExp(`${source}$`, "u");
}

function lexicalQuery(query: string) {
  const terms = searchTerms(query);
  if (terms.length < 2) return { pattern: query };
  return { pattern: terms.map(escapeRegex).join("|"), regex: true };
}

function searchTerms(query: string) {
  return [
    ...new Set(
      (
        query
          .normalize("NFKC")
          .toLocaleLowerCase()
          .match(/[\p{L}\p{N}_$@./-]+/gu) ?? []
      ).filter(Boolean),
    ),
  ].slice(0, 12);
}

function rankedTextMatches(matches: LexicalSearchMatch[], query: string) {
  const terms = searchTerms(query);
  const unique = new Map<string, LexicalSearchMatch>();
  for (const match of matches) {
    const key = `${match.path}:${match.line_range.join(":")}:${match.excerpt}`;
    if (!unique.has(key)) unique.set(key, match);
  }
  return [...unique.values()].sort((left, right) => {
    const score = textMatchScore(right, terms) - textMatchScore(left, terms);
    return score || left.path.localeCompare(right.path);
  });
}

function textMatchScore(match: LexicalSearchMatch, terms: string[]) {
  const path = match.path.toLocaleLowerCase();
  const content = `${path}\n${match.excerpt.toLocaleLowerCase()}`;
  const coverage = terms.filter((term) => content.includes(term)).length;
  const pathCoverage = terms.filter((term) => path.includes(term)).length;
  return coverage * 100 + pathCoverage * 20;
}

function firstTermIndex(source: string, terms: string[], query: string) {
  const normalized = source.toLocaleLowerCase();
  const needles = terms.length ? terms : [query.toLocaleLowerCase()];
  return needles.reduce((best, needle) => {
    const index = normalized.indexOf(needle);
    return index >= 0 && (best < 0 || index < best) ? index : best;
  }, -1);
}

function matchedTerm(
  source: string,
  index: number,
  terms: string[],
  query: string,
) {
  const normalized = source.toLocaleLowerCase();
  const needles = terms.length ? terms : [query.toLocaleLowerCase()];
  const needle = needles.find((candidate) =>
    normalized.startsWith(candidate, index),
  );
  return source.slice(index, index + (needle ?? query).length);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function symbolicPath(path: string) {
  const capability = capabilityForPath(path);
  return Boolean(capability?.loaded && capability.level !== "raw");
}

function symbolMatches(symbol: ParsedSymbol, query: string) {
  return (
    symbol.name.toLocaleLowerCase().includes(query) ||
    symbol.qualified_name.toLocaleLowerCase().includes(query)
  );
}

function searchSymbolResult(
  alias: string,
  path: string,
  symbol: ReturnType<typeof materializeSymbol>,
) {
  return {
    alias,
    path,
    lines: symbol.line_range,
    kind: symbol.kind,
    qualifiedName: symbol.qualified_name,
    signature: symbol.signature,
    reason: "symbol_name",
  };
}

function qualifiedTarget(value: string) {
  return value.includes("#") && !value.startsWith("#");
}

function routedView(
  input: LightReadCodeInput,
  path: string,
  characters: number,
) {
  if (input.view && input.view !== "auto") return input.view;
  if (characters <= smallFileCharacters) return "raw" as const;
  const capability = capabilityForPath(path);
  return capability?.loaded && capability.level !== "raw"
    ? ("outline" as const)
    : ("raw" as const);
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

function lineRange(content: Buffer, range: [number, number]): [number, number] {
  const start = content
    .subarray(0, range[0])
    .toString("utf8")
    .split("\n").length;
  const count = content
    .subarray(...range)
    .toString("utf8")
    .split("\n").length;
  return [start, start + count - 1];
}

function sourceLine(source: string, index: number) {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  return source
    .slice(start, end < 0 ? source.length : end)
    .trim()
    .slice(0, 500);
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
