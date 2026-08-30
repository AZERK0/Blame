import {
  resolveSemanticCandidate,
  semanticRebasePolicyVersion,
  type SemanticEvidenceClass,
  type SemanticResolutionInput,
  type SemanticResolutionReceipt,
} from "@blame/harness-core";
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
import { maximumSemanticParseBytes } from "./code-navigation-policy.js";

export type ConflictCandidate = {
  referenceId: string;
  path: string;
  symbolKind: string;
  qualifiedName?: string;
  line: number;
  score: number;
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
  receipt: SemanticResolutionReceipt;
  score: number;
};

type DecodedTarget = {
  handle: HandlePayload;
  scheme: "match" | "node" | "sym";
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
    target:
      | { symbol_ref: string }
      | { node_ref: string }
      | { match_ref: string },
    snapshot: WorkspaceSnapshot,
    options: ResolveOptions = {},
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
    const candidates = await this.rebaseCandidates(decoded, snapshot);
    return selectCandidate(candidates, decoded, snapshot, options);
  }

  private rebaseCandidates(
    decoded: DecodedTarget,
    snapshot: WorkspaceSnapshot,
  ) {
    if (decoded.scheme === "sym")
      return this.symbolCandidates(decoded, snapshot);
    if (decoded.scheme === "match")
      return this.matchCandidates(decoded, snapshot);
    return this.nodeCandidates(decoded, snapshot);
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
      receipt: {
        policy: semanticRebasePolicyVersion,
        resolution: unchangedBlob ? "exact" : "automatically_rebased",
        evidence_classes: [
          unchangedBlob ? "exact_digest" : "exact_original_position",
        ],
        score: 1,
        original_path: handle.path,
        resolved_path: handle.path,
        requested_source_revision_id: handle.revision,
        current_source_revision_id: snapshot.revision.source_revision_id,
      },
      score: 1,
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
      if (!content || content.length > maximumSemanticParseBytes) continue;
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
      if (!content || content.length > maximumSemanticParseBytes) continue;
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

  private async matchCandidates(
    decoded: DecodedTarget,
    snapshot: WorkspaceSnapshot,
  ) {
    if (decoded.handle.matchedText === undefined) return [];
    const candidates: ScoredCandidate[] = [];
    for (const path of candidatePaths(decoded.handle, snapshot)) {
      const content = await optionalContent(this.files, path);
      if (!content || content.length > maximumSemanticParseBytes) continue;
      for (const range of exactTextRanges(content, decoded.handle.matchedText))
        candidates.push(
          matchCandidate(decoded.handle, path, content, range, snapshot),
        );
      if (path === decoded.handle.path && candidates.length === 1) break;
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
  decoded: DecodedTarget,
  snapshot: WorkspaceSnapshot,
  options: ResolveOptions,
): ResolvedSemanticReference {
  const decision = resolveSemanticCandidate({
    mode: options.mode ?? "read",
    operation: options.operation ?? "inspect",
    requested_source_revision_id: decoded.handle.revision,
    current_source_revision_id: snapshot.revision.source_revision_id,
    original_path: decoded.handle.path,
    language_id:
      decoded.handle.language ?? semanticLanguageName(decoded.handle.path),
    syntax_kind: decoded.handle.kind ?? "unknown",
    candidates: candidates.map(coreCandidate),
    cas_generated: options.casGenerated ?? false,
    post_validation_available: options.postValidationAvailable ?? false,
  });
  const selected = decision.candidate
    ? candidates.find(
        (candidate) => candidate.reference === decision.candidate!.candidate_id,
      )
    : undefined;
  if (!selected)
    throw new SemanticResolutionConflict(
      decision.reason_code === "AMBIGUOUS_TARGET"
        ? "Several semantic targets remain plausible."
        : "The semantic target could not be safely resolved.",
      candidates.map(publicCandidate),
    );
  return {
    handle: selected.handle,
    path: selected.path,
    reference: selected.reference,
    rebased: true,
    strategy: selected.strategy,
    receipt: decision.receipt,
    score: selected.score,
  };
}

type ResolveOptions = {
  allowRebase?: boolean;
  mode?: SemanticResolutionInput["mode"];
  operation?: SemanticResolutionInput["operation"];
  casGenerated?: boolean;
  postValidationAvailable?: boolean;
};

function coreCandidate(candidate: ScoredCandidate) {
  return {
    candidate_id: candidate.reference,
    path: candidate.path,
    language_id:
      candidate.handle.language ?? semanticLanguageName(candidate.path),
    syntax_kind: candidate.handle.kind ?? "unknown",
    score: candidate.score,
    evidence_classes: evidenceClasses(candidate.strategy),
  };
}

function evidenceClasses(strategy: string): SemanticEvidenceClass[] {
  if (/symbol_fingerprint/u.test(strategy))
    return ["unique_symbol_fingerprint"];
  if (/qualified_name_signature/u.test(strategy))
    return ["unique_qualified_name_and_signature"];
  if (/node_fingerprint/u.test(strategy))
    return ["unique_body_and_ancestry_fingerprint"];
  if (/text_match/u.test(strategy)) return ["unique_lexical_match"];
  if (strategy === "neighbor_ordinal") return ["neighbor_and_ordinal_only"];
  return ["bounded_similarity_only"];
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
    score: Number(input.score.toFixed(3)),
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
  target: { symbol_ref: string } | { node_ref: string } | { match_ref: string },
): DecodedTarget {
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
    throw new SemanticResolutionConflict(
      "The target reference is invalid.",
      [],
    );
  return { handle, scheme };
}

function exactTextRanges(content: Buffer, text: string) {
  const needle = Buffer.from(text);
  if (!needle.length) return [];
  const ranges: Array<[number, number]> = [];
  let offset = 0;
  while (offset <= content.length - needle.length) {
    const start = content.indexOf(needle, offset);
    if (start < 0) break;
    ranges.push([start, start + needle.length]);
    offset = start + needle.length;
  }
  return ranges;
}

function matchCandidate(
  original: HandlePayload,
  path: string,
  content: Buffer,
  range: [number, number],
  snapshot: WorkspaceSnapshot,
): ScoredCandidate {
  const score = path === original.path ? 1 : 0.9;
  const handle = currentMatchHandle(original, path, content, range, snapshot);
  const reference = encodeHandle("match", handle);
  return {
    handle,
    path,
    reference,
    score,
    strategy: path === original.path ? "unique_text_match" : "moved_text_match",
    materialized: conflictCandidate({
      content,
      kind: "text_match",
      lineRange: byteLineRange(content, range),
      path,
      reference,
      score,
    }),
  };
}

function currentMatchHandle(
  original: HandlePayload,
  path: string,
  content: Buffer,
  range: [number, number],
  snapshot: WorkspaceSnapshot,
): HandlePayload {
  return {
    ...original,
    revision: snapshot.revision.source_revision_id,
    path,
    start: range[0],
    end: range[1],
    digest: sha256(content.subarray(...range)).slice(0, 32),
    observedBlobHash: sha256(content).slice(0, 32),
  };
}

function byteLineRange(
  content: Buffer,
  range: [number, number],
): [number, number] {
  const start = content
    .subarray(0, range[0])
    .toString("utf8")
    .split("\n").length;
  const lines = content
    .subarray(...range)
    .toString("utf8")
    .split("\n").length;
  return [start, start + Math.max(0, lines - 1)];
}

async function optionalContent(files: WorkspaceFiles, path: string) {
  try {
    return (await files.read(path)).content;
  } catch {
    return undefined;
  }
}
