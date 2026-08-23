import { parseCode } from "./code-intelligence.js";
import {
  searchWithRipgrep,
  type LexicalSearchMatch,
} from "./lexical-search.js";
import {
  decodeHandle,
  harnessSuccess,
  provenance,
  sha256,
} from "./protocol.js";
import {
  approximateTokens,
  nodeRef,
  revisionVector,
  staleRevision,
  toolError,
} from "./semantic-workspace-support.js";
import {
  getRelationContextInputSchema,
  type GetRelationContextInput,
} from "./schemas.js";
import type { WorkspaceFiles, WorkspaceSnapshot } from "./workspace-files.js";

type RelationKind = NonNullable<GetRelationContextInput["relations"]>[number];

type RelationItem = {
  relation: RelationKind;
  path: string;
  line_range: [number, number];
  excerpt?: string;
  node_ref?: string;
};

export class RelationService {
  private readonly files: WorkspaceFiles;

  constructor(files: WorkspaceFiles) {
    this.files = files;
  }

  async getRelationContext(
    input: GetRelationContextInput,
    signal?: AbortSignal,
  ) {
    const startedAt = Date.now();
    try {
      getRelationContextInputSchema.parse(input);
      const snapshot = await this.exactSnapshot(
        input.source_revision_id,
        signal,
      );
      const context = await this.context(input, snapshot, signal);
      await this.exactSnapshot(input.source_revision_id, signal);
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
      target: {
        kind: target.kind,
        name: target.name,
        path: target.path,
        qualified_name: target.qualifiedName,
      },
      items: bounded.items.slice(0, maximum),
      counts: relationCounts(items),
      truncated:
        matches.truncated || bounded.truncated || items.length > maximum,
    };
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
    const handle = decodeHandle(input.target.symbol_ref, "sym");
    if (!handle || handle.revision !== snapshot.revision.source_revision_id)
      throw new Error(`STALE_REVISION:${snapshot.revision.source_revision_id}`);
    const path = this.files.normalizePath(handle.path);
    const content = (await this.files.read(path)).content;
    if (sha256(content.subarray(handle.start, handle.end)) !== handle.digest)
      throw new Error(`TARGET_GONE:${path}`);
    const symbol = parseCode(path, content).symbols.find(
      (candidate) =>
        candidate.range_utf8_bytes[0] === handle.start &&
        candidate.range_utf8_bytes[1] === handle.end,
    );
    if (!symbol) throw new Error(`TARGET_GONE:${path}`);
    return {
      content,
      end: handle.end,
      kind: symbol.kind,
      name: symbol.name,
      path,
      qualifiedName: symbol.qualified_name,
      start: handle.start,
    };
  }

  private async exactSnapshot(expected: string, signal?: AbortSignal) {
    const snapshot = await this.files.snapshot(signal);
    if (snapshot.revision.source_revision_id !== expected)
      throw staleRevision(snapshot.revision.source_revision_id);
    return snapshot;
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
        relationItem(
          match,
          content,
          relation,
          include,
          input.source_revision_id,
        ),
      );
    }
    return items.sort(compareRelationItems);
  }
}

function relationSuccess(
  startedAt: number,
  snapshot: WorkspaceSnapshot,
  context: Awaited<ReturnType<RelationService["context"]>>,
) {
  const revision = revisionVector(snapshot);
  return harnessSuccess({
    startedAt,
    revision,
    provenance: [provenance("lexical", revision)],
    data: {
      ...context,
      analysis: "heuristic",
      omitted_boundary: context.truncated ? "budget_or_result_limit" : null,
    },
    coverage: {
      scope: context.truncated ? "partial" : "complete",
      truncated: context.truncated,
      analysis: "heuristic",
    },
  });
}

function relationItem(
  match: LexicalSearchMatch,
  content: Buffer,
  relation: RelationKind,
  include: Set<string>,
  revision: string,
): RelationItem {
  return {
    relation,
    path: match.path,
    line_range: match.line_range,
    ...(include.has("excerpts") ? { excerpt: match.excerpt } : {}),
    ...(include.has("node_refs")
      ? {
          node_ref: nodeRef(
            revision,
            match.path,
            content,
            match.range_utf8_bytes[0],
            match.range_utf8_bytes[1],
            "relation_match",
          ),
        }
      : {}),
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
  references: 4,
};
