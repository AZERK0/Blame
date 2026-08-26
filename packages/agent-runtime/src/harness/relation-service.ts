import { parseCode, smallestEnclosingNode } from "./code-intelligence.js";
import {
  searchWithRipgrep,
  type LexicalSearchMatch,
} from "./lexical-search.js";
import { harnessSuccess, provenance } from "./protocol.js";
import {
  approximateTokens,
  matchRef,
  revisionVector,
  toolError,
} from "./semantic-workspace-support.js";
import { SemanticReferenceResolver } from "./semantic-reference-resolver.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import {
  getRelationContextInputSchema,
  type GetRelationContextInput,
  type RelationKind,
} from "./schemas.js";
import type {
  SemanticRelationIndex,
  SemanticRelationRecord,
  SemanticRelationUnavailable,
  SemanticTarget,
} from "./semantic-relations.js";
import { TypeScriptSemanticService } from "./typescript-semantic-service.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

type RelationItem = {
  certainty?: "may" | "must";
  relation: RelationKind;
  path: string;
  line_range: [number, number];
  range_utf8_bytes?: [number, number];
  excerpt?: string;
  match_ref?: string;
  node_ref?: string;
};

export class RelationService {
  private readonly files: WorkspaceFiles;
  private readonly resolver: SemanticReferenceResolver;
  private readonly semantic: TypeScriptSemanticService;

  constructor(files: WorkspaceFiles) {
    this.files = files;
    this.resolver = new SemanticReferenceResolver(files);
    this.semantic = new TypeScriptSemanticService(files);
  }

  async getRelationContext(
    input: GetRelationContextInput,
    signal?: AbortSignal,
  ) {
    const startedAt = Date.now();
    try {
      getRelationContextInputSchema.parse(input);
      const snapshot = await this.files.snapshot(signal);
      const currentInput = {
        ...input,
        source_revision_id: snapshot.revision.source_revision_id,
      };
      const context = await this.context(currentInput, snapshot, signal);
      await ensureUnchanged(this.files, snapshot, signal);
      return relationSuccess(startedAt, snapshot, context);
    } catch (error) {
      return toolError(error);
    }
  }

  async context(
    input: GetRelationContextInput,
    snapshot: WorkspaceSnapshot,
    signal?: AbortSignal,
  ) {
    const target = await this.resolveTarget(input, snapshot);
    const semantic = await this.semantic.relations({
      target,
      snapshot,
      signal,
    });
    if (semantic.available)
      return this.semanticContext(input, target, semantic.index);
    return this.heuristicContext(
      input,
      target,
      snapshot,
      semantic.unavailable,
      signal,
    );
  }

  private async heuristicContext(
    input: GetRelationContextInput,
    target: SemanticTarget,
    snapshot: WorkspaceSnapshot,
    unavailable: SemanticRelationUnavailable,
    signal?: AbortSignal,
  ) {
    const maximum = input.max_results ?? 30;
    const matches = await this.search(
      target.name,
      scopedPaths(snapshot.files, input.scope?.paths),
      maximum * 3,
      input.scope?.paths,
      signal,
    );
    const items = await this.relationItems(input, target, matches.items);
    const bounded = boundItems(items, input.budget?.max_output_tokens ?? 1_800);
    return {
      target: publicTarget(target),
      items: bounded.items.slice(0, maximum),
      counts: relationCounts(items),
      analysis: "heuristic" as const,
      engine: "ripgrep" as const,
      fallback_reason: unavailable.reason,
      producer: "lexical" as const,
      truncated:
        matches.truncated || bounded.truncated || items.length > maximum,
    };
  }

  private async semanticContext(
    input: GetRelationContextInput,
    target: SemanticTarget,
    index: SemanticRelationIndex,
  ) {
    const maximum = input.max_results ?? 30;
    const requested = new Set(input.relations ?? defaultRelations);
    const records = index.items.flatMap((item) =>
      requestedRelations(item, requested, input.scope?.paths),
    );
    const items = await this.semanticItems(input, records);
    const bounded = boundItems(items, input.budget?.max_output_tokens ?? 1_800);
    return {
      target: publicTarget(target),
      items: bounded.items.slice(0, maximum),
      counts: relationCounts(items),
      analysis: "exact" as const,
      cache: { hit: index.cacheHit, scope: "symbol" as const },
      engine: index.engine,
      engine_version: index.engineVersion,
      index_revision_id: index.indexRevisionId,
      producer: "compiler" as const,
      project_kind: index.projectKind,
      truncated: !index.complete || bounded.truncated || items.length > maximum,
    };
  }

  private async semanticItems(
    input: GetRelationContextInput,
    records: SemanticRelationRecord[],
  ) {
    const include = new Set(input.include ?? ["excerpts"]);
    const contents = new Map<string, Buffer>();
    return Promise.all(
      records.map(async (record) => {
        const content = include.has("node_refs")
          ? await cachedContent(this.files, contents, record.path)
          : undefined;
        return semanticRelationItem(
          record,
          include,
          sourceRevision(input),
          content,
        );
      }),
    );
  }

  async impact(input: {
    changedPaths: string[];
    names: string[];
    snapshot: WorkspaceSnapshot;
    signal?: AbortSignal;
    tokenBudget: number;
  }) {
    const names = unique(input.names).slice(0, 30);
    if (!names.length)
      return { changed_symbols: [], impacted_files: [], truncated: false };
    const pattern = names.map(escapeRegExp).join("|");
    const matches = await this.searchRegex(
      pattern,
      input.snapshot.files,
      300,
      input.signal,
    );
    const files = await impactedFiles(
      this.files,
      matches.items,
      new Set(input.changedPaths),
    );
    const bounded = boundItems(files, input.tokenBudget);
    return {
      changed_symbols: names,
      impacted_files: bounded.items,
      truncated: matches.truncated || bounded.truncated,
    };
  }

  private async resolveTarget(
    input: GetRelationContextInput,
    snapshot: WorkspaceSnapshot,
  ) {
    const resolved = await this.resolver.resolve(input.target, snapshot, {
      allowRebase: harnessFeatureEnabled("BLAME_SEMANTIC_READ_REBASE"),
    });
    const handle = resolved.handle;
    const path = resolved.path;
    const content = (await this.files.read(path)).content;
    const symbol = parseCode(path, content).symbols.find(
      (candidate) =>
        candidate.range_utf8_bytes[0] === handle.start &&
        candidate.range_utf8_bytes[1] === handle.end,
    );
    if (!symbol) throw new Error(`TARGET_GONE:${path}`);
    return {
      digest: handle.digest,
      end: handle.end,
      kind: symbol.kind,
      name: symbol.name,
      path,
      qualifiedName: symbol.qualified_name,
      start: handle.start,
    };
  }

  private search(
    name: string,
    candidates: string[],
    maximum: number,
    scopePaths?: string[],
    signal?: AbortSignal,
  ) {
    return searchWithRipgrep({
      candidates,
      maximum,
      query: { kind: "text", pattern: name, case_sensitive: true },
      root: this.files.root,
      scopePaths,
      signal,
    });
  }

  private searchRegex(
    pattern: string,
    candidates: string[],
    maximum: number,
    signal?: AbortSignal,
  ) {
    return searchWithRipgrep({
      candidates,
      maximum,
      query: { kind: "text", pattern, regex: true, case_sensitive: true },
      root: this.files.root,
      signal,
    });
  }

  private async relationItems(
    input: GetRelationContextInput,
    target: Awaited<ReturnType<RelationService["resolveTarget"]>>,
    matches: LexicalSearchMatch[],
  ) {
    const requested = new Set(input.relations ?? defaultRelations);
    const include = new Set(input.include ?? ["excerpts"]);
    const contents = new Map<string, Buffer>();
    const items: RelationItem[] = [];
    for (const match of matches) {
      const content = await cachedContent(this.files, contents, match.path);
      if (!identifierMatch(content, match.range_utf8_bytes)) continue;
      if (isTargetDefinition(match, target)) continue;
      const relation = classifyRelation(match, target.name);
      if (!requested.has(relation)) continue;
      items.push(
        relationItem(match, content, relation, include, sourceRevision(input)),
      );
    }
    return items.sort(compareRelationItems);
  }
}

async function ensureUnchanged(
  files: WorkspaceFiles,
  snapshot: WorkspaceSnapshot,
  signal?: AbortSignal,
) {
  const current = await files.snapshot(signal);
  if (
    current.revision.source_revision_id !== snapshot.revision.source_revision_id
  )
    throw new Error(`STALE_REVISION:${current.revision.source_revision_id}`);
}

function sourceRevision(input: GetRelationContextInput) {
  if (!input.source_revision_id)
    throw new Error("The current source revision is unavailable.");
  return input.source_revision_id;
}

function relationSuccess(
  startedAt: number,
  snapshot: WorkspaceSnapshot,
  context: Awaited<ReturnType<RelationService["context"]>>,
) {
  const { producer, ...data } = context;
  const metadata = semanticMetadata(context);
  const revision = { ...revisionVector(snapshot), ...metadata.revision };
  return harnessSuccess({
    startedAt,
    revision,
    provenance: [relationProvenance(context, producer, revision, metadata)],
    data: {
      ...data,
      omitted_boundary: context.truncated ? "budget_or_result_limit" : null,
    },
    coverage: {
      scope: context.truncated ? "partial" : "complete",
      truncated: context.truncated,
      analysis: context.analysis,
    },
  });
}

function relationProvenance(
  context: Awaited<ReturnType<RelationService["context"]>>,
  producer: "compiler" | "lexical",
  revision: ReturnType<typeof revisionVector>,
  metadata: ReturnType<typeof semanticMetadata>,
) {
  const paths = unique([
    context.target.path,
    ...context.items.map((item) => item.path),
  ]);
  return { ...provenance(producer, revision, paths), ...metadata.provenance };
}

function semanticMetadata(
  context: Awaited<ReturnType<RelationService["context"]>>,
) {
  const indexRevisionId =
    "index_revision_id" in context ? context.index_revision_id : undefined;
  const engineVersion =
    "engine_version" in context ? context.engine_version : undefined;
  return {
    provenance: engineVersion ? { producer_version: engineVersion } : {},
    revision: indexRevisionId ? { index_revision_id: indexRevisionId } : {},
  };
}

function semanticRelationItem(
  record: SemanticRelationRecord,
  include: Set<string>,
  revision: string,
  content?: Buffer,
): RelationItem {
  const references = content
    ? relationReferences(
        content,
        record.path,
        record.range_utf8_bytes,
        include,
        revision,
      )
    : {};
  return {
    certainty: record.certainty,
    relation: record.relation,
    path: record.path,
    line_range: record.line_range,
    ...(include.has("excerpts") ? { excerpt: record.excerpt } : {}),
    ...references,
  };
}

function relationItem(
  match: LexicalSearchMatch,
  content: Buffer,
  relation: RelationKind,
  include: Set<string>,
  revision: string,
): RelationItem {
  const references = relationReferences(
    content,
    match.path,
    match.range_utf8_bytes,
    include,
    revision,
  );
  return {
    certainty: "may",
    relation,
    path: match.path,
    line_range: match.line_range,
    ...(include.has("excerpts") ? { excerpt: match.excerpt } : {}),
    ...references,
  };
}

function relationReferences(
  content: Buffer,
  path: string,
  range: [number, number],
  include: Set<string>,
  revision: string,
) {
  if (!include.has("node_refs")) return {};
  const enclosing = smallestEnclosingNode({
    content,
    end: range[1],
    path,
    revision,
    start: range[0],
  });
  return {
    match_ref: matchRef(revision, path, content, range[0], range[1]),
    ...(enclosing ? { node_ref: enclosing.node_ref } : {}),
  };
}

async function impactedFiles(
  files: WorkspaceFiles,
  matches: LexicalSearchMatch[],
  changedPaths: Set<string>,
) {
  const contentByPath = new Map<string, Buffer>();
  const grouped = new Map<
    string,
    { relations: Set<RelationKind>; symbols: Set<string> }
  >();
  for (const match of matches) {
    if (changedPaths.has(match.path)) continue;
    const content = await cachedContent(files, contentByPath, match.path);
    if (!identifierMatch(content, match.range_utf8_bytes)) continue;
    const current = grouped.get(match.path) ?? {
      relations: new Set<RelationKind>(),
      symbols: new Set<string>(),
    };
    current.relations.add(classifyRelation(match, matchedText(content, match)));
    current.symbols.add(matchedText(content, match));
    grouped.set(match.path, current);
  }
  return [...grouped.entries()]
    .map(([path, value]) => ({
      path,
      relations: [...value.relations].sort(),
      symbols: [...value.symbols].sort(),
      test: isTestPath(path),
    }))
    .sort(
      (left, right) =>
        Number(right.test) - Number(left.test) ||
        left.path.localeCompare(right.path),
    );
}

async function cachedContent(
  files: WorkspaceFiles,
  cache: Map<string, Buffer>,
  path: string,
) {
  const cached = cache.get(path);
  if (cached) return cached;
  const content = (await files.read(path)).content;
  cache.set(path, content);
  return content;
}

function classifyRelation(
  match: LexicalSearchMatch,
  name: string,
): RelationKind {
  if (isTestPath(match.path)) return "tested_by";
  if (/\b(?:import|require|use|using|from)\b/u.test(match.excerpt))
    return "imports";
  if (/\b(?:implements|extends)\b/u.test(match.excerpt)) return "implements";
  const call = new RegExp(
    `(?:\\bnew\\s+)?\\b${escapeRegExp(name)}\\s*\\(`,
    "u",
  );
  return call.test(match.excerpt) ? "calls" : "references";
}

function identifierMatch(content: Buffer, range: [number, number]) {
  const before =
    range[0] > 0 ? String.fromCharCode(content[range[0] - 1]!) : "";
  const after =
    range[1] < content.length ? String.fromCharCode(content[range[1]]!) : "";
  return !/[\p{L}\p{N}_$]/u.test(before) && !/[\p{L}\p{N}_$]/u.test(after);
}

function matchedText(content: Buffer, match: LexicalSearchMatch) {
  return content.subarray(...match.range_utf8_bytes).toString("utf8");
}

function isTargetDefinition(
  match: LexicalSearchMatch,
  target: { path: string; start: number; end: number },
) {
  return (
    match.path === target.path &&
    match.range_utf8_bytes[0] >= target.start &&
    match.range_utf8_bytes[1] <= target.end
  );
}

function isTestPath(path: string) {
  return /(?:^|\/)(?:__tests__|tests?|spec)(?:\/|\.)|\.(?:spec|test)\.[^/]+$/iu.test(
    path,
  );
}

function scopedPaths(files: string[], paths?: string[]) {
  if (!paths?.length) return files;
  return files.filter((path) =>
    paths.some((scope) => path === scope || path.startsWith(`${scope}/`)),
  );
}

function pathInScope(path: string, paths?: string[]) {
  return (
    !paths?.length ||
    paths.some((scope) => path === scope || path.startsWith(`${scope}/`))
  );
}

function requestedRelations(
  item: SemanticRelationRecord,
  requested: Set<RelationKind>,
  paths?: string[],
) {
  if (!pathInScope(item.path, paths)) return [];
  const records: SemanticRelationRecord[] = [];
  if (requested.has(item.relation)) records.push(item);
  const accessRelation =
    item.access === "read"
      ? "reads"
      : item.access === "write"
        ? "writes"
        : null;
  if (accessRelation && requested.has(accessRelation))
    records.push({ ...item, certainty: "must", relation: accessRelation });
  return records;
}

function publicTarget(target: SemanticTarget) {
  return {
    kind: target.kind,
    name: target.name,
    path: target.path,
    qualified_name: target.qualifiedName,
  };
}

function relationCounts(items: RelationItem[]) {
  const counts: Partial<Record<RelationKind, number>> = {};
  for (const item of items)
    counts[item.relation] = (counts[item.relation] ?? 0) + 1;
  return counts;
}

function boundItems<T>(items: T[], tokenBudget: number) {
  const bounded = [...items];
  while (bounded.length && approximateTokens(bounded) > tokenBudget)
    bounded.pop();
  return { items: bounded, truncated: bounded.length < items.length };
}

function compareRelationItems(left: RelationItem, right: RelationItem) {
  return (
    relationPriority[left.relation] - relationPriority[right.relation] ||
    left.path.localeCompare(right.path) ||
    left.line_range[0] - right.line_range[0]
  );
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const defaultRelations: RelationKind[] = [
  "calls",
  "imports",
  "references",
  "tested_by",
];

const relationPriority: Record<RelationKind, number> = {
  calls: 0,
  implements: 1,
  imports: 2,
  tested_by: 3,
  writes: 4,
  reads: 5,
  references: 6,
};
