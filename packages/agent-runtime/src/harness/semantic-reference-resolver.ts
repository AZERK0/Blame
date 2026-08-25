import {
  currentNodeCandidates,
  materializeSymbol,
  normalizedSignature,
  parseCode,
  semanticLanguageName,
  type ParsedSymbol,
} from "./code-intelligence.js";
import {
  decodeHandle,
  encodeHandle,
  sha256,
  type HandlePayload,
} from "./protocol.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";

export type ConflictCandidate = {
  referenceId: string;
  path: string;
  symbolKind: string;
  qualifiedName?: string;
  line: number;
  confidence: number;
  excerpt: string;
  target_ref: string;
  kind: string;
  line_range: [number, number];
};

export type ResolvedSemanticReference = {
  handle: HandlePayload;
  path: string;
  reference: string;
  rebased: boolean;
  strategy: string;
  confidence: number;
};

type DecodedTarget = {
  handle: HandlePayload;
  scheme: "node" | "sym";
};

type ScoredCandidate = {
  handle: HandlePayload;
  materialized: ConflictCandidate;
  path: string;
  reference: string;
  score: number;
  strategy: string;
};

export class SemanticReferenceResolver {
  private readonly files: WorkspaceFiles;

  constructor(files: WorkspaceFiles) {
    this.files = files;
  }

  async resolve(
    target: { symbol_ref: string } | { node_ref: string },
    snapshot: WorkspaceSnapshot,
    options: { allowRebase?: boolean } = {},
  ): Promise<ResolvedSemanticReference> {
    const decoded = decodeTarget(target);
    const allowRebase =
      options.allowRebase ?? harnessFeatureEnabled("BLAME_SEMANTIC_REBASE_V2");
    if (
      !allowRebase &&
      decoded.handle.revision !== snapshot.revision.source_revision_id
    )
      throw new SemanticResolutionConflict(
        "The target reference is stale.",
        [],
      );
    const positioned = await this.atOriginalPosition(decoded, snapshot);
    if (positioned) return positioned;
    if (!allowRebase)
      throw new SemanticResolutionConflict(
        "The target reference is stale.",
        [],
      );
    const candidates =
      decoded.scheme === "sym"
        ? await this.symbolCandidates(decoded, snapshot)
        : await this.nodeCandidates(decoded, snapshot);
    return selectCandidate(candidates);
  }

  private async atOriginalPosition(
    decoded: DecodedTarget,
    snapshot: WorkspaceSnapshot,
  ) {
    const content = await optionalContent(this.files, decoded.handle.path);
    if (!content) return undefined;
    const handle = decoded.handle;
    const fragment = content.subarray(handle.start, handle.end);
    if (!sha256(fragment).startsWith(handle.digest)) return undefined;
    const blob = sha256(content);
    const unchangedBlob = Boolean(
      handle.observedBlobHash && blob.startsWith(handle.observedBlobHash),
    );
    const current = {
      ...handle,
      revision: snapshot.revision.source_revision_id,
      observedBlobHash: blob,
    };
    return {
      handle: current,
      path: handle.path,
      reference: encodeHandle(decoded.scheme, current),
      rebased: !unchangedBlob,
      strategy: unchangedBlob ? "unchanged_blob" : "original_position",
      confidence: 1,
    } satisfies ResolvedSemanticReference;
  }

  private async symbolCandidates(
    decoded: DecodedTarget,
    snapshot: WorkspaceSnapshot,
  ) {
    const paths = candidatePaths(decoded.handle, snapshot);
    const candidates: ScoredCandidate[] = [];
    for (const path of paths) {
      const content = await optionalContent(this.files, path);
      if (!content || content.length > 2 * 1024 * 1024) continue;
      candidates.push(...scoreSymbols(decoded.handle, path, content, snapshot));
      if (candidates.some((candidate) => candidate.score >= 0.98)) break;
    }
    return candidates
      .sort((left, right) => right.score - left.score)
      .slice(0, 12);
  }

  private async nodeCandidates(
    decoded: DecodedTarget,
    snapshot: WorkspaceSnapshot,
  ) {
    const candidates: ScoredCandidate[] = [];
    for (const path of candidatePaths(decoded.handle, snapshot)) {
      const content = await optionalContent(this.files, path);
      if (!content || content.length > 2 * 1024 * 1024) continue;
      const matches = currentNodeCandidates({
        content,
        digest: decoded.handle.digest,
        kind: decoded.handle.kind,
        path,
        revision: snapshot.revision.source_revision_id,
      });
      for (const match of matches) {
        const handle = decodeHandle(match.node_ref, "node");
        if (!handle) continue;
        const score = path === decoded.handle.path ? 1 : 0.94;
        candidates.push({
          handle,
          path,
          reference: match.node_ref,
          score,
          strategy:
            path === decoded.handle.path
              ? "node_fingerprint"
              : "cross_file_node_fingerprint",
          materialized: conflictCandidate({
            content,
            kind: match.kind,
            lineRange: match.line_range,
            path,
            reference: match.node_ref,
            score,
          }),
        });
      }
      if (candidates.length === 1 && candidates[0]!.score === 1) break;
    }
    return candidates
      .sort((left, right) => right.score - left.score)
      .slice(0, 12);
  }
}

export class SemanticResolutionConflict extends Error {
  readonly candidates: ConflictCandidate[];

  constructor(message: string, candidates: ConflictCandidate[]) {
    super(message);
    this.candidates = candidates;
  }
}

function scoreSymbols(
  original: HandlePayload,
  path: string,
  content: Buffer,
  snapshot: WorkspaceSnapshot,
) {
  const parsed = parseCode(path, content);
  return parsed.symbols
    .map((symbol, ordinal) =>
      scoreSymbol(
        original,
        symbol,
        ordinal,
        parsed.symbols,
        path,
        content,
        snapshot,
      ),
    )
    .filter((candidate) => candidate.score >= 0.45);
}

function scoreSymbol(
  original: HandlePayload,
  symbol: ParsedSymbol,
  ordinal: number,
  symbols: ParsedSymbol[],
  path: string,
  content: Buffer,
  snapshot: WorkspaceSnapshot,
): ScoredCandidate {
  const materialized = materializeSymbol({
    symbol,
    path,
    revision: snapshot.revision.source_revision_id,
    content,
    ordinal,
    neighborNames: neighborNames(symbols, ordinal),
  });
  const handle = decodeHandle(materialized.symbol_ref, "sym")!;
  const fullDigest = sha256(content.subarray(...symbol.range_utf8_bytes));
  let score = fullDigest.startsWith(original.digest) ? 0.82 : 0;
  score += original.kind === symbol.kind ? 0.12 : 0;
  score += original.qualifiedName === symbol.qualified_name ? 0.3 : 0;
  score += originalName(original) === symbol.name ? 0.12 : 0;
  score += signatureMatches(original, symbol) ? 0.18 : 0;
  score += fingerprintMatches(original.bodyFingerprint, handle.bodyFingerprint)
    ? 0.28
    : 0;
  score += fingerprintMatches(
    original.ancestryFingerprint,
    handle.ancestryFingerprint,
  )
    ? 0.06
    : 0;
  score += fingerprintMatches(
    original.neighborFingerprint,
    handle.neighborFingerprint,
  )
    ? 0.05
    : 0;
  score += original.ordinal === ordinal ? 0.03 : 0;
  score += path === original.path ? 0.08 : 0;
  score = Math.min(score, 1);
  return {
    handle,
    path,
    reference: materialized.symbol_ref,
    score,
    strategy: rebaseStrategy(original, handle, path, fullDigest),
    materialized: conflictCandidate({
      content,
      kind: symbol.kind,
      lineRange: symbol.line_range,
      path,
      qualifiedName: symbol.qualified_name,
      reference: materialized.symbol_ref,
      score,
    }),
  };
}

function selectCandidate(
  candidates: ScoredCandidate[],
): ResolvedSemanticReference {
  const selected = candidates[0];
  const runnerUp = candidates[1];
  if (!selected || selected.score < 0.58)
    throw new SemanticResolutionConflict(
      "The semantic target is gone.",
      candidates.map(publicCandidate),
    );
  if (runnerUp && selected.score - runnerUp.score < 0.1)
    throw new SemanticResolutionConflict(
      "Several semantic targets remain plausible.",
      candidates.map(publicCandidate),
    );
  return {
    handle: selected.handle,
    path: selected.path,
    reference: selected.reference,
    rebased: true,
    strategy: selected.strategy,
    confidence: selected.score,
  };
}

function candidatePaths(handle: HandlePayload, snapshot: WorkspaceSnapshot) {
  const changed = snapshot.changes.map((change) => change.path);
  const paths = [handle.path, ...changed, ...snapshot.files];
  return [...new Set(paths)]
    .filter((path) => snapshot.files.includes(path))
    .filter(
      (path) =>
        !handle.language || semanticLanguageName(path) === handle.language,
    )
    .slice(0, 200);
}

function conflictCandidate(input: {
  content: Buffer;
  kind: string;
  lineRange: [number, number];
  path: string;
  qualifiedName?: string;
  reference: string;
  score: number;
}): ConflictCandidate {
  const lines = input.content.toString("utf8").split("\n");
  const excerpt = lines
    .slice(input.lineRange[0] - 1, input.lineRange[0] + 2)
    .join("\n")
    .slice(0, 320);
  return {
    referenceId: input.reference,
    path: input.path,
    symbolKind: input.kind,
    ...(input.qualifiedName ? { qualifiedName: input.qualifiedName } : {}),
    line: input.lineRange[0],
    confidence: Number(input.score.toFixed(3)),
    excerpt,
    target_ref: input.reference,
    kind: input.kind,
    line_range: input.lineRange,
  };
}

function publicCandidate(candidate: ScoredCandidate) {
  return candidate.materialized;
}

function signatureMatches(original: HandlePayload, symbol: ParsedSymbol) {
  if (!original.signatureDigest) return false;
  return sha256(normalizedSignature(symbol.signature)).startsWith(
    original.signatureDigest,
  );
}

function fingerprintMatches(left?: string, right?: string) {
  return Boolean(
    left && right && (left.startsWith(right) || right.startsWith(left)),
  );
}

function originalName(handle: HandlePayload) {
  return handle.qualifiedName?.split(/\.|::/u).at(-1);
}

function neighborNames(symbols: ParsedSymbol[], ordinal: number) {
  return [
    symbols[ordinal - 1]?.qualified_name,
    symbols[ordinal + 1]?.qualified_name,
  ].filter((value): value is string => Boolean(value));
}

function rebaseStrategy(
  original: HandlePayload,
  current: HandlePayload,
  path: string,
  digest: string,
) {
  if (digest.startsWith(original.digest))
    return path === original.path
      ? "symbol_fingerprint"
      : "cross_file_symbol_fingerprint";
  if (original.qualifiedName === current.qualifiedName)
    return path === original.path
      ? "qualified_name_signature"
      : "moved_qualified_name_signature";
  if (original.neighborFingerprint === current.neighborFingerprint)
    return "neighbor_ordinal";
  return path === original.path ? "bounded_same_file" : "bounded_same_language";
}

function decodeTarget(
  target: { symbol_ref: string } | { node_ref: string },
): DecodedTarget {
  const scheme = "symbol_ref" in target ? "sym" : "node";
  const value = "symbol_ref" in target ? target.symbol_ref : target.node_ref;
  const handle = decodeHandle(value, scheme);
  if (!handle)
    throw new SemanticResolutionConflict(
      "The target reference is invalid.",
      [],
    );
  return { handle, scheme };
}

async function optionalContent(files: WorkspaceFiles, path: string) {
  try {
    return (await files.read(path)).content;
  } catch {
    return undefined;
  }
}
