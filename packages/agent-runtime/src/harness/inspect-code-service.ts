import {
  findExactNode,
  inspectParsedNode,
  parseCode,
} from "./code-intelligence.js";
import {
  harnessSuccess,
  provenance,
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

type ByteRange = [number, number];
type WorkingSetAvailability = Awaited<ReturnType<ReadWorkingSet["register"]>>;

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
  type: "node" | "symbol";
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

export type InspectCodeData = {
  alreadyAvailable: boolean;
  capabilities: ReturnType<typeof publicLanguageCapabilities>;
  content: string;
  coverage: "complete" | "delta";
  covered_ranges: ByteRange[];
  current_revision_id: string;
  file_ref: FileRef;
  language: string;
  line_range: ByteRange;
  new_bytes: number;
  omitted_bytes: number;
  overlap_rate: number;
  path: string;
  range_utf8_bytes: ByteRange;
  read_receipt_ref: string;
  rebased: boolean;
  rebase_strategy?: string;
  requested_reference: string;
  recommendedEditTool: string | null;
  resolved_reference: string;
  segments: InspectionSegment[];
  selection: string;
  sourceUnchanged: boolean;
  semantic_target?: SemanticTarget;
  status: "already_available" | "content" | "partial";
  view: InspectCodeInput["view"];
};

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
    if (context?.contextEpoch)
      await this.workingSet.activateEpoch(context.contextEpoch);
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

function structuredSelection(
  view: Exclude<InspectCodeInput["view"], "raw"> | "raw",
  handle: HandlePayload,
  path: string,
  content: Buffer,
): InspectedSelection {
  if (view === "raw")
    throw new Error("A semantic reference cannot use the raw view.");
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
  return {
    type: ("symbol_ref" in input.target ? "symbol" : "node") as
      | "node"
      | "symbol",
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
    view: context.input.view,
    range_utf8_bytes: context.inspected.range,
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
