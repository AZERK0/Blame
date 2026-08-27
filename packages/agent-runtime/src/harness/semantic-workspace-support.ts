import { parseCode, smallestEnclosingNode } from "./code-intelligence.js";
import {
  decodeHandle,
  encodeHandle,
  harnessError,
  sha256,
  type HandlePayload,
  type HarnessToolResult,
} from "./protocol.js";
import {
  languageName,
  type WorkspaceFiles,
  type WorkspaceSnapshot,
} from "./workspace-files.js";
import type {
  InspectCodeInput,
  OutlineCodeInput,
  SearchCodeInput,
  StoredChangeProposal,
} from "./schemas.js";
import { SemanticResolutionConflict } from "./semantic-reference-resolver.js";

export type {
  InspectCodeInput,
  OutlineCodeInput,
  ReviewChangeInput,
  SearchCodeInput,
} from "./schemas.js";

export type PublicChangeProposal = {
  proposal_ref: string;
  base_source_revision_id: string;
  created_at: string;
  changes: Array<{
    path: string;
    old_hash: string | null;
    new_hash: string | null;
  }>;
  diff: string;
  diff_truncated: boolean;
  diff_bytes?: number;
  formatting?: StoredChangeProposal["formatting"];
};

export type SearchMatch = {
  path: string;
  line_range: [number, number];
  range_utf8_bytes: [number, number];
  excerpt?: string;
  match_reason: string;
  context?: string;
  matched_text?: string;
  match_ref?: string;
  node_ref?: string;
  node_text?: string;
  symbol_ref?: string;
};

export function textMatches(
  content: Buffer,
  path: string,
  revision: string,
  query: Extract<SearchCodeInput["query"], { kind: "text" }>,
  maximum: number,
): SearchMatch[] {
  const source = content.toString("utf8");
  const flags = `g${query.case_sensitive ? "" : "i"}u`;
  const expression = query.regex
    ? new RegExp(query.pattern, flags)
    : new RegExp(escapeRegExp(query.pattern), flags);
  const items: SearchMatch[] = [];
  for (const match of source.matchAll(expression)) {
    const index = match.index ?? 0;
    const text = match[0];
    if (!text.length) continue;
    const start = Buffer.byteLength(source.slice(0, index));
    const end = start + Buffer.byteLength(text);
    const line = source.slice(0, index).split("\n").length;
    items.push(
      lexicalMatch(
        content,
        path,
        revision,
        [start, end],
        [line, line + text.split("\n").length - 1],
        query.regex ? "lexical_regex" : "lexical_exact",
      ),
    );
    if (items.length >= maximum) break;
  }
  return items;
}

export function lexicalMatch(
  content: Buffer,
  path: string,
  revision: string,
  range: [number, number],
  lineRange: [number, number],
  reason: "lexical_exact" | "lexical_regex",
): SearchMatch {
  const matchedText = content.subarray(...range).toString("utf8");
  const context = lineExcerpt(
    content.toString("utf8"),
    byteIndex(content, range[0]),
  );
  const promotion = lexicalPromotion(content, path, revision, range, [
    matchedText,
    context,
  ]);
  return {
    path,
    line_range: lineRange,
    range_utf8_bytes: range,
    context,
    matched_text: matchedText,
    match_reason: reason,
    match_ref: matchRef(revision, path, content, range[0], range[1]),
    ...promotion,
  };
}

function lexicalPromotion(
  content: Buffer,
  path: string,
  revision: string,
  range: [number, number],
  visibleText: string[],
) {
  const enclosing = smallestEnclosingNode({
    content,
    end: range[1],
    path,
    revision,
    start: range[0],
  });
  if (!enclosing) return {};
  const bytes = enclosing.range_utf8_bytes[1] - enclosing.range_utf8_bytes[0];
  if (bytes > 4_096) return {};
  const nodeText = enclosing.text.trim();
  const duplicate = visibleText.some((text) => text.trim() === nodeText);
  return {
    node_ref: enclosing.node_ref,
    ...(duplicate ? {} : { node_text: enclosing.text }),
  };
}

export function matchRef(
  revision: string,
  path: string,
  content: Buffer,
  start: number,
  end: number,
) {
  const matchedText = content.subarray(start, end).toString("utf8");
  return encodeHandle("match", {
    version: 2,
    revision,
    path,
    start,
    end,
    digest: sha256(content.subarray(start, end)).slice(0, 32),
    observedBlobHash: sha256(content).slice(0, 32),
    kind: "text_match",
    language: languageName(path),
    matchedText,
  });
}

export function nodeRef(
  revision: string,
  path: string,
  content: Buffer,
  start: number,
  end: number,
  kind: string,
) {
  return encodeHandle("node", {
    version: 2,
    revision,
    path,
    start,
    end,
    digest: sha256(content.subarray(start, end)).slice(0, 32),
    observedBlobHash: sha256(content).slice(0, 32),
    kind,
    language: languageName(path),
  });
}

export function inspectTarget(target: InspectCodeInput["target"]): {
  path?: string;
  handle?: HandlePayload;
} {
  if ("path" in target) return { path: target.path };
  const scheme =
    "symbol_ref" in target ? "sym" : "match_ref" in target ? "match" : "node";
  const value =
    "symbol_ref" in target
      ? target.symbol_ref
      : "match_ref" in target
        ? target.match_ref
        : target.node_ref;
  const handle = decodeHandle(value, scheme);
  if (!handle)
    throw new Error(
      `A valid ${scheme === "sym" ? "symbol_ref" : `${scheme}_ref`} is required.`,
    );
  return { handle };
}

export function compareSymbols(
  change: StoredChangeProposal["changes"][number],
  beforeContent?: Buffer,
  afterContent?: Buffer,
) {
  const oldSymbols = symbolRecords(change.path, beforeContent);
  const newSymbols = symbolRecords(change.path, afterContent);
  return {
    added: [...newSymbols.keys()].filter((symbol) => !oldSymbols.has(symbol)),
    removed: [...oldSymbols.keys()].filter((symbol) => !newSymbols.has(symbol)),
    modified: [...newSymbols.keys()].filter(
      (symbol) =>
        oldSymbols.has(symbol) &&
        oldSymbols.get(symbol)?.digest !== newSymbols.get(symbol)?.digest,
    ),
  };
}

export function semanticSymbolDiff(
  path: string,
  beforeContent?: Buffer,
  afterContent?: Buffer,
) {
  const before = symbolRecords(path, beforeContent);
  const after = symbolRecords(path, afterContent);
  return {
    added: [...after.entries()]
      .filter(([key]) => !before.has(key))
      .map(([, symbol]) => publicSemanticSymbol(symbol)),
    removed: [...before.entries()]
      .filter(([key]) => !after.has(key))
      .map(([, symbol]) => publicSemanticSymbol(symbol)),
    modified: [...after.entries()]
      .filter(([key, symbol]) => before.get(key)?.digest !== symbol.digest)
      .filter(([key]) => before.has(key))
      .map(([key, symbol]) => ({
        ...publicSemanticSymbol(symbol),
        change:
          before.get(key)!.signature === symbol.signature
            ? "implementation"
            : "signature",
        before_signature: before.get(key)!.signature,
        after_signature: symbol.signature,
      })),
  };
}

export function semanticDiffNames(
  value: ReturnType<typeof semanticSymbolDiff>,
) {
  return [
    ...value.added.map((symbol) => symbol.qualified_name),
    ...value.removed.map((symbol) => symbol.qualified_name),
    ...value.modified.map((symbol) => symbol.qualified_name),
  ].map((name) => name.split(".").at(-1) ?? name);
}

export function publicProposal(
  proposal: StoredChangeProposal,
): PublicChangeProposal {
  return {
    proposal_ref: proposal.proposal_ref,
    base_source_revision_id: proposal.base_source_revision_id,
    created_at: proposal.created_at,
    changes: proposal.changes.map(({ path, old_hash, new_hash }) => ({
      path,
      old_hash,
      new_hash,
    })),
    diff: proposal.diff_summary,
    diff_truncated: proposal.diff_summary_truncated ?? false,
    ...(proposal.diff_bytes !== undefined
      ? { diff_bytes: proposal.diff_bytes }
      : {}),
    ...(proposal.formatting ? { formatting: proposal.formatting } : {}),
  };
}

export function scopedFiles(
  files: WorkspaceFiles,
  paths: string[],
  scope?: SearchCodeInput["scope"],
) {
  const scopedPaths = scope?.paths?.map((path) => files.normalizePath(path));
  return paths.filter((path) => {
    if (
      scope?.languages?.length &&
      !scope.languages.includes(languageName(path))
    )
      return false;
    if (!scopedPaths?.length) return true;
    return scopedPaths.some(
      (candidate) =>
        candidate === "." ||
        path === candidate ||
        path.startsWith(`${candidate}/`),
    );
  });
}

export function validateSearchInput(input: SearchCodeInput) {
  const value =
    input.query.kind === "symbol" ? input.query.name : input.query.pattern;
  if (!value?.trim()) throw new Error("Search query cannot be empty.");
  if (
    input.query.kind === "text" &&
    input.query.regex &&
    (/\\[1-9]/.test(value) || /\([^)]*[+*][^)]*\)[+*{]/.test(value))
  )
    throw new Error(
      "Regex contains a potentially unbounded nested quantifier or backreference.",
    );
}

export function validateOutlineInput(input: OutlineCodeInput) {
  if (!input.target?.path?.trim()) throw new Error("target.path is required.");
}

export function validateInspectInput(input: InspectCodeInput) {
  if (!input.target || !input.view)
    throw new Error("target and view are required.");
}

export function validRange(
  value: [number, number],
  maximum: number,
): [number, number] {
  if (
    value.length !== 2 ||
    !Number.isSafeInteger(value[0]) ||
    !Number.isSafeInteger(value[1]) ||
    value[0] < 0 ||
    value[1] < value[0] ||
    value[1] > maximum
  )
    throw new Error("range_utf8_bytes is outside the file.");
  return value;
}

export function revisionVector(snapshot: WorkspaceSnapshot) {
  return { source_revision_id: snapshot.revision.source_revision_id };
}

export function staleRevision(current: string) {
  return new Error(`STALE_REVISION:${current}`);
}

export function toolError<T = never>(error: unknown): HarnessToolResult<T> {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof SemanticResolutionConflict)
    return harnessError({
      code: error.candidates.length ? "AMBIGUOUS_TARGET" : "TARGET_GONE",
      message,
      recovery: {
        candidates: error.candidates,
        action: error.candidates.length
          ? "Choose one returned candidate reference."
          : "Run one targeted search if the symbol was removed or renamed beyond recognition.",
      },
    });
  if (message.startsWith("STALE_REVISION:")) {
    const current = message.slice("STALE_REVISION:".length);
    return harnessError({
      code: "STALE_REVISION",
      message: "The workspace changed after the supplied source revision.",
      revision: { source_revision_id: current },
      recovery: {
        action:
          "Call workspace_state, then repeat the read or rebuild the proposal.",
      },
    });
  }
  if (message.startsWith("UNSUPPORTED_CAPABILITY:"))
    return harnessError({
      code: "UNSUPPORTED_CAPABILITY",
      message: message.slice("UNSUPPORTED_CAPABILITY:".length),
      recovery: {
        action: "Use a capability reported as available by workspace_state.",
      },
    });
  for (const code of [
    "EXECUTION_ERROR",
    "IO_ERROR",
    "POLICY_DENIED",
  ] as const) {
    if (message.startsWith(`${code}:`))
      return harnessError({
        code,
        message: message.slice(code.length + 1),
      });
  }
  for (const code of ["TARGET_GONE", "UNSUPPORTED_STRUCTURE"] as const) {
    if (message.startsWith(`${code}:`))
      return harnessError({
        code,
        message: message.slice(code.length + 1),
        recovery: {
          action:
            code === "TARGET_GONE"
              ? "Search or outline the current revision for a new handle."
              : "Use inspect_code with view raw.",
        },
      });
  }
  if (
    /outside the workspace|escapes the workspace|metadata paths cannot|policy protects|access policy denies|absolute paths are not allowed|symbolic-link files are not supported/i.test(
      message,
    )
  )
    return harnessError({
      code: "POLICY_DENIED",
      message,
      recovery: { action: "Choose a regular path inside the workspace." },
    });
  const precondition =
    /precondition|syntax errors|already bound|already exists|overlapping/i.test(
      message,
    );
  return harnessError({
    code: precondition ? "PRECONDITION_FAILED" : "INVALID_INPUT",
    message,
    recovery: precondition
      ? { action: "Inspect the current revision and create a new proposal." }
      : undefined,
  });
}

export function bounded(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
) {
  return Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value!)))
    : fallback;
}

export function countBy(values: string[]) {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

export function topLevelEntries(paths: string[]) {
  return [...new Set(paths.map((path) => path.split("/", 1)[0]))].sort();
}

export function symbolNameMatches(candidate: string, query: string) {
  return candidate
    .toLocaleLowerCase()
    .includes(query.trim().toLocaleLowerCase());
}

export function approximateTokens(value: unknown) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), "utf8") / 4);
}

function symbolRecords(path: string, content?: Buffer) {
  const result = new Map<
    string,
    { digest: string; kind: string; qualified_name: string; signature: string }
  >();
  if (!content) return result;
  for (const symbol of parseCode(path, content).symbols) {
    const key = `${symbol.kind}:${symbol.qualified_name}`;
    const [start, end] = symbol.range_utf8_bytes;
    result.set(key, {
      digest: sha256(content.subarray(start, end)),
      kind: symbol.kind,
      qualified_name: symbol.qualified_name,
      signature: symbol.signature,
    });
  }
  return result;
}

function publicSemanticSymbol(symbol: {
  kind: string;
  qualified_name: string;
  signature: string;
}) {
  return {
    kind: symbol.kind,
    qualified_name: symbol.qualified_name,
    signature: symbol.signature,
  };
}

function lineExcerpt(source: string, index: number) {
  const start = source.lastIndexOf("\n", index - 1) + 1;
  const end = source.indexOf("\n", index);
  const line = source.slice(start, end < 0 ? source.length : end).trim();
  return line.length > 300 ? `${line.slice(0, 299)}…` : line;
}

function byteIndex(content: Buffer, offset: number) {
  return content.subarray(0, offset).toString("utf8").length;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
