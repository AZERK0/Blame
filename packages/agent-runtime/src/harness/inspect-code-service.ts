import {
  findExactNode,
  inspectParsedNode,
  materializeSymbol,
  outlineSymbol,
  parseCode,
  type OutlineSymbol,
} from "./code-intelligence.js";
import {
  harnessSuccess,
  provenance,
  sha256,
  type FileRef,
  type HandlePayload,
  type HarnessToolResult,
} from "./protocol.js";
import { ReadWorkingSet } from "./read-working-set.js";
import {
  SemanticReferenceResolver,
  type ResolvedSemanticReference,
} from "./semantic-reference-resolver.js";
import { inspectCodeInputSchema } from "./schemas.js";
import {
  bounded,
  approximateTokens,
  revisionVector,
  staleRevision,
  toolError,
  validRange,
  validateInspectInput,
  type InspectCodeInput,
} from "./semantic-workspace-support.js";
import { WorkspaceFiles, type WorkspaceSnapshot } from "./workspace-files.js";
import { harnessFeatureEnabled } from "./harness-feature-flags.js";
import {
  languageCapability,
  publicLanguageCapabilities,
  recommendedEditTool,
} from "./language-capabilities.js";
import {
  autoNarrowedOutlineMaximumItems,
  autoNarrowedMaximumOutputTokens,
  autoNarrowedPreviewMaximumBytes,
  fullRawReadMaximumBytes,
  fullRawReadMaximumLines,
  maximumSemanticParseBytes,
  rawReadProfile,
  type RawReadProfile,
} from "./code-navigation-policy.js";

type ByteRange = [number, number];
type WorkingSetAvailability = Awaited<ReturnType<ReadWorkingSet["register"]>>;

type NarrowedView = {
  contentCoverage: "none" | "partial";
  content: string;
  items: OutlineSymbol[];
  kind: AutoNarrowedInspectCodeData["auto_narrowed_kind"];
  reason: AutoNarrowedInspectCodeData["auto_narrow_reason"];
  recommendation: string;
  returnedBytes: number;
  returnedSourceRange?: ByteRange;
};

export type InspectionSegment = {
  content: string;
  line_range: ByteRange;
  path: string;
  range_utf8_bytes: ByteRange;
};

type InspectedSelection = {
  analysis: "exact" | "heuristic";
  range: ByteRange;
};

type SemanticTarget = {
  kind?: string;
  qualified_name?: string;
  type: "match" | "node" | "symbol";
};

type InspectionSource = {
  content: Buffer;
  fileRef: FileRef;
  inspected: InspectedSelection;
  path: string;
  rebased: boolean;
  rebaseStrategy?: string;
  requestedReference: string;
  resolvedHandle?: HandlePayload;
  resolvedReference: string;
  snapshot: WorkspaceSnapshot;
};

type InspectionContext = InspectionSource & {
  availability: WorkingSetAvailability;
  input: InspectCodeInput;
  lineRange: ByteRange;
  semanticTarget?: SemanticTarget;
  startedAt: number;
};

export type ContentInspectCodeData = {
  alreadyAvailable: boolean;
  capabilities: ReturnType<typeof publicLanguageCapabilities>;
  content: string;
  coverage: "complete" | "delta";
  covered_ranges: ByteRange[];
  current_revision_id: string;
  file_ref: FileRef;
  file_size: number;
  language: string;
  line_range: ByteRange;
  new_bytes: number;
  omitted_bytes: number;
  overlap_rate: number;
  path: string;
  range_utf8_bytes: ByteRange;
  requested_range: ByteRange;
  read_receipt_ref: string;
  rebased: boolean;
  rebase_strategy?: string;
  requested_reference: string;
  recommendedEditTool: string | null;
  resolved_reference: string;
  returned_bytes: number;
  returned_range?: ByteRange;
  returned_ranges: ByteRange[];
  segments: InspectionSegment[];
  selection: string;
  sourceUnchanged: boolean;
  semantic_target?: SemanticTarget;
  status: "already_available" | "content" | "partial";
  view: InspectCodeInput["view"];
};

export type AutoNarrowedInspectCodeData = {
  alreadyAvailable: false;
  auto_narrowed_kind: "bounded_preview" | "semantic_outline";
  auto_narrow_reason:
    | "broad_raw_read"
    | "semantic_outline"
    | "semantic_outline_unavailable"
    | "semantic_parse_limit";
  capabilities: ReturnType<typeof publicLanguageCapabilities>;
  content_coverage: "none" | "partial";
  coverage: "none" | "partial";
  content: string;
  current_revision_id: string;
  estimated_tokens_saved: number;
  file_ref: FileRef;
  file_size_bytes: number;
  file_size: number;
  items: OutlineSymbol[];
  language: string;
  line_range?: ByteRange;
  new_bytes: number;
  omitted_bytes: number;
  path: string;
  read_receipt_ref: string;
  read_requested_bytes: number;
  read_returned_bytes: number;
  returned_bytes: number;
  returned_range?: ByteRange;
  range_utf8_bytes?: ByteRange;
  rebased: boolean;
  rebase_strategy?: string;
  recommendation: string;
  recommendedEditTool: string | null;
  requested_reference: string;
  requested_coverage_ratio: number;
  requested_line_count?: number;
  requested_line_range: ByteRange;
  requested_range_utf8_bytes: ByteRange;
  requested_range: ByteRange;
  resolved_reference: string;
  source_bytes_returned: number;
  sourceUnchanged: true;
  status: "auto_narrowed";
  threshold_bytes: number;
  threshold_lines: number;
  view: "raw";
};

export type InspectCodeData =
  | AutoNarrowedInspectCodeData
  | ContentInspectCodeData;

export class InspectCodeService {
  private readonly files: WorkspaceFiles;
  private readonly resolver: SemanticReferenceResolver;
  private readonly workingSet: ReadWorkingSet;

  constructor(files: WorkspaceFiles, sessionId?: string) {
    this.files = files;
    this.resolver = new SemanticReferenceResolver(files);
    this.workingSet = new ReadWorkingSet(files.root, sessionId);
  }

  async inspect(
    input: InspectCodeInput,
    signal?: AbortSignal,
    context?: { contextEpoch?: string },
  ): Promise<HarnessToolResult<InspectCodeData>> {
    const startedAt = Date.now();
    try {
      inspectCodeInputSchema.parse(input);
      validateInspectInput(input);
      return await this.inspectValid(input, startedAt, signal, context);
    } catch (error) {
      return toolError(error);
    }
  }

  invalidatePaths(paths: string[]) {
    return this.workingSet.invalidatePaths(paths);
  }

  private async inspectValid(
    input: InspectCodeInput,
    startedAt: number,
    signal?: AbortSignal,
    context?: { contextEpoch?: string },
  ) {
    const source = await inspectionSource(
      this.files,
      this.resolver,
      input,
      signal,
    );
    if (context?.contextEpoch) await this.workingSet.activateEpoch();
    const narrowed = autoNarrowedResult(source, input, startedAt);
    if (narrowed) {
      await ensureUnchanged(this.files, source.snapshot, signal);
      return narrowed;
    }
    const availability = await this.workingSet.register({
      contextEpoch: context?.contextEpoch,
      deduplicateByBytes: harnessFeatureEnabled("BLAME_WORKING_SET_V2"),
      maximumBytes: maximumOutputBytes(input),
      path: source.path,
      range: source.inspected.range,
      sourceContent: source.content,
      sourceBlob: source.fileRef.blob_hash,
      targetRef: source.resolvedReference,
      view: input.view,
    });
    await ensureUnchanged(this.files, source.snapshot, signal);
    const inspection = createContext({
      availability,
      ...source,
      input,
      startedAt,
    });
    return availability.alreadyAvailable
      ? alreadyAvailableResult(inspection)
      : contentResult(inspection);
  }
}

async function inspectionSource(
  files: WorkspaceFiles,
  resolver: SemanticReferenceResolver,
  input: InspectCodeInput,
  signal?: AbortSignal,
): Promise<InspectionSource> {
  const snapshot = await files.snapshot(signal);
  if ("path" in input.target) return rawSource(files, input, snapshot);
  const resolved = await resolver.resolve(input.target, snapshot, {
    allowRebase: harnessFeatureEnabled("BLAME_SEMANTIC_READ_REBASE"),
  });
  return semanticSource(files, input, snapshot, resolved);
}

async function rawSource(
  files: WorkspaceFiles,
  input: InspectCodeInput,
  snapshot: WorkspaceSnapshot,
): Promise<InspectionSource> {
  const path = files.normalizePath(
    "path" in input.target ? input.target.path : ".",
  );
  const content = (await files.read(path)).content;
  const fileRef = await files.fileRef(
    path,
    snapshot.revision.source_revision_id,
    content,
  );
  const range = input.range_utf8_bytes
    ? validRange(input.range_utf8_bytes, content.length)
    : ([0, content.length] as ByteRange);
  return {
    content,
    fileRef,
    inspected: { analysis: "exact", range },
    path,
    rebased: Boolean(
      input.source_revision_id &&
      input.source_revision_id !== snapshot.revision.source_revision_id,
    ),
    ...(input.source_revision_id &&
    input.source_revision_id !== snapshot.revision.source_revision_id
      ? { rebaseStrategy: "current_file_revision" }
      : {}),
    requestedReference: path,
    resolvedReference: fileRef.ref,
    snapshot,
  };
}

async function semanticSource(
  files: WorkspaceFiles,
  input: InspectCodeInput,
  snapshot: WorkspaceSnapshot,
  resolved: ResolvedSemanticReference,
): Promise<InspectionSource> {
  const content = (await files.read(resolved.path)).content;
  const fileRef = await files.fileRef(
    resolved.path,
    snapshot.revision.source_revision_id,
    content,
  );
  return {
    content,
    fileRef,
    inspected: structuredSelection(
      input.view,
      resolved.handle,
      resolved.path,
      content,
    ),
    path: resolved.path,
    rebased: resolved.rebased,
    ...(resolved.rebased ? { rebaseStrategy: resolved.strategy } : {}),
    requestedReference: requestedReference(input),
    resolvedHandle: resolved.handle,
    resolvedReference: resolved.reference,
    snapshot,
  };
}

function autoNarrowedResult(
  source: InspectionSource,
  input: InspectCodeInput,
  startedAt: number,
) {
  if (!rawPathInput(input)) return undefined;
  const profile = rawReadProfile(source.content, source.inspected.range);
  if (!profile.broad) return undefined;
  if (profile.estimatedBytes <= maximumOutputBytes(input)) return undefined;
  const capability = languageCapability(source.path, source.content);
  if (!capability.symbolInspection)
    return boundedPreviewResult(
      source,
      capability,
      profile,
      startedAt,
      "broad_raw_read",
    );
  const outline = semanticOutlineAttempt(source);
  return "items" in outline
    ? semanticOutlineResult(
        source,
        capability,
        profile,
        outline.items,
        startedAt,
      )
    : boundedPreviewResult(
        source,
        capability,
        profile,
        startedAt,
        outline.reason,
      );
}

function semanticOutlineResult(
  source: InspectionSource,
  capability: ReturnType<typeof languageCapability>,
  profile: RawReadProfile,
  items: OutlineSymbol[],
  startedAt: number,
) {
  return autoNarrowedSuccess(source, capability, profile, startedAt, {
    contentCoverage: "none",
    content: "",
    items,
    kind: "semantic_outline",
    reason: "semantic_outline",
    returnedBytes: compactOutlineBytes(items),
    recommendation:
      "Inspect one returned symbol_ref, or narrow search_code when the symbol is absent.",
  });
}

function semanticOutlineAttempt(source: InspectionSource):
  | {
      items: OutlineSymbol[];
    }
  | {
      reason: "semantic_outline_unavailable" | "semantic_parse_limit";
    } {
  if (source.content.byteLength > maximumSemanticParseBytes)
    return { reason: "semantic_parse_limit" };
  const parsed = parseCode(source.path, source.content);
  if (!parsed.supported || parsed.errorCount > 0 || !parsed.symbols.length)
    return { reason: "semantic_outline_unavailable" };
  const items = parsed.symbols
    .slice(0, autoNarrowedOutlineMaximumItems)
    .map((symbol) =>
      outlineSymbol(
        materializeSymbol({
          symbol,
          path: source.path,
          revision: source.snapshot.revision.source_revision_id,
          content: source.content,
        }),
        [],
      ),
    );
  while (
    items.length > 1 &&
    approximateTokens(items) > autoNarrowedMaximumOutputTokens
  )
    items.pop();
  return { items };
}

function compactOutlineBytes(items: OutlineSymbol[]) {
  const compactItems = items.map((item, index) => ({
    ...item,
    symbol_ref: `s_${index.toString(36)}`,
  }));
  return Buffer.byteLength(JSON.stringify(compactItems), "utf8");
}

function boundedPreviewResult(
  source: InspectionSource,
  capability: ReturnType<typeof languageCapability>,
  profile: RawReadProfile,
  startedAt: number,
  reason: NarrowedView["reason"],
) {
  const requestedRange = profile.requestedRange ?? source.inspected.range;
  const previewBytes = Math.min(
    profile.estimatedBytes,
    autoNarrowedPreviewMaximumBytes,
  );
  const returnedSourceRange = [
    requestedRange[0],
    requestedRange[0] + previewBytes,
  ] as ByteRange;
  const content = source.content
    .subarray(returnedSourceRange[0], returnedSourceRange[1])
    .toString("utf8");
  return autoNarrowedSuccess(source, capability, profile, startedAt, {
    contentCoverage: previewBytes ? "partial" : "none",
    content,
    items: [],
    kind: "bounded_preview",
    reason,
    returnedBytes: previewBytes,
    ...(previewBytes ? { returnedSourceRange } : {}),
    recommendation:
      "Use a narrow search_code query or request one precise range_utf8_bytes selection.",
  });
}

function autoNarrowedSuccess(
  source: InspectionSource,
  capability: ReturnType<typeof languageCapability>,
  profile: RawReadProfile,
  startedAt: number,
  narrowed: NarrowedView,
) {
  const revision = revisionVector(source.snapshot);
  const data = autoNarrowedData(source, capability, profile, narrowed);
  return harnessSuccess({
    startedAt,
    revision,
    provenance: [
      provenance(
        narrowed.kind === "semantic_outline" ? "parser" : "filesystem",
        revision,
        [source.path],
      ),
    ],
    data,
    coverage: { scope: "partial", truncated: true, analysis: "exact" },
  });
}

function autoNarrowedData(
  source: InspectionSource,
  capability: ReturnType<typeof languageCapability>,
  profile: RawReadProfile,
  narrowed: NarrowedView,
): AutoNarrowedInspectCodeData {
  const requestedRange = profile.requestedRange ?? source.inspected.range;
  return {
    ...autoNarrowedIdentity(source, capability, narrowed),
    ...autoNarrowedReadMetrics(source, profile, narrowed),
    ...autoNarrowedReferences(source, requestedRange, narrowed),
    requested_line_range: byteLineRange(source.content, requestedRange),
    requested_range: requestedRange,
    requested_range_utf8_bytes: requestedRange,
    ...(narrowed.returnedSourceRange
      ? {
          line_range: byteLineRange(
            source.content,
            narrowed.returnedSourceRange,
          ),
          range_utf8_bytes: narrowed.returnedSourceRange,
          returned_range: narrowed.returnedSourceRange,
        }
      : {}),
  };
}

function autoNarrowedIdentity(
  source: InspectionSource,
  capability: ReturnType<typeof languageCapability>,
  narrowed: NarrowedView,
) {
  return {
    status: "auto_narrowed",
    auto_narrowed_kind: narrowed.kind,
    auto_narrow_reason: narrowed.reason,
    alreadyAvailable: false,
    path: source.path,
    language: capability.languageId,
    capabilities: publicLanguageCapabilities(capability),
    recommendedEditTool: recommendedEditTool(capability),
    file_ref: source.fileRef,
    view: "raw",
    content_coverage: narrowed.contentCoverage,
    coverage: narrowed.contentCoverage,
    content: narrowed.content,
    items: narrowed.items,
    recommendation: narrowed.recommendation,
    sourceUnchanged: true,
  } as const;
}

function autoNarrowedReadMetrics(
  source: InspectionSource,
  profile: RawReadProfile,
  narrowed: NarrowedView,
) {
  const sourceBytes = narrowed.returnedSourceRange
    ? narrowed.returnedSourceRange[1] - narrowed.returnedSourceRange[0]
    : 0;
  return {
    file_size_bytes: source.content.byteLength,
    file_size: source.content.byteLength,
    read_requested_bytes: profile.estimatedBytes,
    read_returned_bytes: narrowed.returnedBytes,
    returned_bytes: narrowed.returnedBytes,
    source_bytes_returned: sourceBytes,
    omitted_bytes: Math.max(0, profile.estimatedBytes - sourceBytes),
    requested_coverage_ratio: profile.coverageRatio ?? 0,
    ...(profile.lineCount === undefined
      ? {}
      : { requested_line_count: profile.lineCount }),
    rebased: source.rebased,
    ...(source.rebaseStrategy
      ? { rebase_strategy: source.rebaseStrategy }
      : {}),
    new_bytes: narrowed.returnedBytes,
    estimated_tokens_saved: Math.max(
      0,
      Math.ceil((profile.estimatedBytes - narrowed.returnedBytes) / 4),
    ),
    threshold_bytes: fullRawReadMaximumBytes,
    threshold_lines: fullRawReadMaximumLines,
  };
}

function autoNarrowedReferences(
  source: InspectionSource,
  requestedRange: ByteRange,
  narrowed: NarrowedView,
) {
  return {
    read_receipt_ref: `auto-narrowed://${sha256(
      `${source.fileRef.blob_hash}\0${narrowed.kind}\0${requestedRange.join(":")}`,
    )}`,
    requested_reference: source.path,
    resolved_reference: source.fileRef.ref,
    current_revision_id: source.snapshot.revision.source_revision_id,
  };
}

function rawPathInput(input: InspectCodeInput) {
  return input.view === "raw" && "path" in input.target;
}

function structuredSelection(
  view: Exclude<InspectCodeInput["view"], "raw"> | "raw",
  handle: HandlePayload,
  path: string,
  content: Buffer,
): InspectedSelection {
  if (view === "raw")
    return { analysis: "exact", range: [handle.start, handle.end] };
  const parsed = parseCode(path, content);
  const node = findExactNode(
    parsed,
    content,
    handle.start,
    handle.end,
    handle.digest,
  );
  if (!node) throw new Error(`UNSUPPORTED_STRUCTURE:${path}`);
  const inspected = inspectParsedNode({ content, parsed: node, view });
  return {
    analysis: parsed.errorCount ? "heuristic" : "exact",
    range: inspected.range_utf8_bytes,
  };
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
    throw staleRevision(current.revision.source_revision_id);
}

function createContext(
  input: Omit<InspectionContext, "lineRange" | "semanticTarget">,
) {
  return {
    ...input,
    lineRange: byteLineRange(input.content, input.inspected.range),
    semanticTarget: semanticTarget(input.input, input.resolvedHandle),
  } satisfies InspectionContext;
}

function semanticTarget(input: InspectCodeInput, handle?: HandlePayload) {
  if (!handle) return undefined;
  const type: SemanticTarget["type"] =
    "symbol_ref" in input.target
      ? "symbol"
      : "match_ref" in input.target
        ? "match"
        : "node";
  return {
    type,
    ...(handle.kind ? { kind: handle.kind } : {}),
    ...(handle.qualifiedName ? { qualified_name: handle.qualifiedName } : {}),
  };
}

function alreadyAvailableResult(context: InspectionContext) {
  const revision = revisionVector(context.snapshot);
  return harnessSuccess({
    startedAt: context.startedAt,
    revision,
    provenance: [provenance("harness", revision, [context.path])],
    data: {
      ...sharedData(context),
      status: "already_available" as const,
      alreadyAvailable: true,
      content: "",
      segments: [],
      coverage: "complete" as const,
      overlap_rate: 1,
      new_bytes: 0,
      returned_bytes: 0,
      returned_ranges: [],
      omitted_bytes: 0,
      sourceUnchanged: true,
    },
  });
}

function contentResult(context: InspectionContext) {
  const segments = inspectionSegments(context);
  const truncated = context.availability.omittedBytes > 0;
  const revision = revisionVector(context.snapshot);
  return harnessSuccess({
    startedAt: context.startedAt,
    revision,
    provenance: [inspectionProvenance(context, revision)],
    data: {
      ...sharedData(context),
      alreadyAvailable: false,
      status:
        context.availability.overlapRate > 0
          ? ("partial" as const)
          : ("content" as const),
      content: segments.length === 1 ? segments[0]!.content : "",
      segments,
      omitted_bytes: context.availability.omittedBytes,
      overlap_rate: context.availability.overlapRate,
      coverage:
        context.availability.overlapRate > 0
          ? ("delta" as const)
          : ("complete" as const),
      new_bytes: newByteCount(context.availability),
      returned_bytes: newByteCount(context.availability),
      returned_ranges: context.availability.newRanges,
      ...(context.availability.newRanges.length === 1
        ? { returned_range: context.availability.newRanges[0] }
        : {}),
      sourceUnchanged: true,
    },
    coverage: {
      scope: truncated ? "partial" : "complete",
      truncated,
      analysis: context.inspected.analysis,
      ...(truncated
        ? { continuation: String(continuationOffset(context)) }
        : {}),
    },
  });
}

function sharedData(context: InspectionContext) {
  const capability = languageCapability(context.path, context.content);
  return {
    language: capability.languageId,
    capabilities: publicLanguageCapabilities(capability),
    recommendedEditTool: recommendedEditTool(capability),
    path: context.path,
    line_range: context.lineRange,
    file_ref: context.fileRef,
    file_size: context.content.byteLength,
    view: context.input.view,
    range_utf8_bytes: context.inspected.range,
    requested_range: context.inspected.range,
    read_receipt_ref: context.availability.receipt.read_receipt_ref,
    selection: `${context.inspected.range[0]}:${context.inspected.range[1]}`,
    covered_ranges: context.availability.receipt.covered_ranges,
    requested_reference: context.requestedReference,
    resolved_reference: context.resolvedReference,
    current_revision_id: context.snapshot.revision.source_revision_id,
    rebased: context.rebased,
    ...(context.rebaseStrategy
      ? { rebase_strategy: context.rebaseStrategy }
      : {}),
    ...(context.semanticTarget
      ? { semantic_target: context.semanticTarget }
      : {}),
  };
}

function inspectionSegments(context: InspectionContext): InspectionSegment[] {
  return context.availability.newRanges.map((range) => ({
    content: context.content.subarray(...range).toString("utf8"),
    line_range: byteLineRange(context.content, range),
    path: context.path,
    range_utf8_bytes: range,
  }));
}

function inspectionProvenance(
  context: InspectionContext,
  revision: ReturnType<typeof revisionVector>,
) {
  return provenance(
    context.input.view === "raw" ? "filesystem" : "parser",
    revision,
    [context.path],
  );
}

function continuationOffset(context: InspectionContext) {
  return (
    context.availability.newRanges.at(-1)?.[1] ?? context.inspected.range[0]
  );
}

function maximumOutputBytes(input: InspectCodeInput) {
  return bounded(input.budget?.max_output_tokens, 100, 20_000, 2_500) * 4;
}

function newByteCount(availability: WorkingSetAvailability) {
  return availability.newRanges.reduce(
    (total, range) => total + range[1] - range[0],
    0,
  );
}

function requestedReference(input: InspectCodeInput) {
  if ("symbol_ref" in input.target) return input.target.symbol_ref;
  if ("match_ref" in input.target) return input.target.match_ref;
  if ("node_ref" in input.target) return input.target.node_ref;
  return input.target.path;
}

function byteLineRange(content: Buffer, [start, end]: ByteRange): ByteRange {
  const first = content.subarray(0, start).toString("utf8").split("\n").length;
  const lines = content
    .subarray(start, end)
    .toString("utf8")
    .split("\n").length;
  return [first, first + Math.max(0, lines - 1)];
}
