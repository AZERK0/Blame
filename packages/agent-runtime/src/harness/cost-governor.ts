import {
  harnessError,
  harnessSuccess,
  type HarnessToolResult,
} from "./protocol.js";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";
import { SemanticLoopDetector } from "./semantic-loop-detector.js";
import {
  maximumParallelBroadReads,
  type RawReadProfile,
} from "./code-navigation-policy.js";

type ToolContext = {
  conversationId?: string;
  contextEpoch?: string;
  iteration: number;
};

type BroadReadSuppressionReason =
  | "BROAD_READ_ALREADY_AVAILABLE"
  | "BROAD_READ_IN_FLIGHT"
  | "ITERATION_READ_BUDGET"
  | "PARALLEL_BROAD_READ_LIMIT";

export type BroadReadAdmission = RawReadProfile & {
  reservationId: string;
  signature: string;
};

type EpochState = {
  editApplied: boolean;
  lowNoveltyReads: number;
  midpointAdvised: boolean;
  reads: number;
  readsWithoutEdit: number;
  recentReadSignatures: string[];
  target: string;
};

export class HarnessCostGovernor {
  private readonly iterationBudget: number;
  private readonly midpoint: number;
  private readonly failureCounts = new Map<string, number>();
  private readonly loops?: SemanticLoopDetector;
  private readonly broadReadReservations = new Map<string, string>();
  private readonly broadReadSignatures = new Set<string>();
  private readonly broadReadsByIteration = new Map<number, number>();
  private readonly absentPackages = new Set<string>();
  private readonly states = new Map<string, EpochState>();
  private readonly taskState = initialState();

  constructor(iterationBudget = 80, semanticLoops = true) {
    this.iterationBudget = Math.max(1, iterationBudget);
    this.midpoint = Math.max(1, Math.ceil(iterationBudget / 2));
    this.loops = semanticLoops ? new SemanticLoopDetector() : undefined;
  }

  before(
    tool: SemanticWorkspaceToolName,
    contextEpoch?: string,
    input?: unknown,
    iteration = 0,
    admission?: BroadReadAdmission,
  ) {
    this.state(contextEpoch);
    const absentPackage = absentPackageTarget(tool, input, this.absentPackages);
    if (absentPackage) return absentPackageReceipt(absentPackage);
    const loopDecision = this.loops?.before(tool, input);
    if (loopDecision) return loopDecision;
    const reserveBlock = this.reserveBlock(tool, input, iteration);
    if (reserveBlock) return reserveBlock;
    if ((this.failureCounts.get(failureSignature(tool, input)) ?? 0) >= 3)
      return harnessError({
        code: "PRECONDITION_FAILED",
        message:
          "This identical tool request failed three times. Stop retrying it and use the remaining turn for validation, cleanup, and the final response.",
      });
    const state = this.taskState;
    const signature = readSignature(tool, input);
    if (
      (admission?.broad || isBroadRead(tool)) &&
      ((state.readsWithoutEdit >= 4 && state.lowNoveltyReads >= 2) ||
        (signature && state.recentReadSignatures.includes(signature)))
    )
      return broadReadReceipt("BROAD_READ_ALREADY_AVAILABLE", admission);
    return this.reserveBroadRead(admission, iteration);
  }

  after<T>(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
    context: ToolContext,
  ) {
    const state = this.state(context.contextEpoch);
    this.loops?.after(tool, input, result);
    this.observe(state, tool, input, result);
    this.observe(this.taskState, tool, input, result);
    this.observeFailure(tool, input, result);
    this.observeAbsentPackages(result);
    const enriched = annotateEpoch(
      result,
      context.contextEpoch,
      context.conversationId,
    );
    const advice = this.advice(state, context);
    if (!advice || enriched.status !== "success") return enriched;
    return {
      ...enriched,
      diagnostics: [
        ...(enriched.diagnostics ?? []),
        { code: "CONTEXT_GOVERNOR", message: advice },
      ],
    };
  }

  newUserRequest() {
    this.loops?.newUserRequest();
  }

  releaseBroadRead(reservationId?: string) {
    if (!reservationId) return;
    const signature = this.broadReadReservations.get(reservationId);
    this.broadReadReservations.delete(reservationId);
    if (signature) this.broadReadSignatures.delete(signature);
  }

  private reserveBroadRead(
    admission: BroadReadAdmission | undefined,
    iteration: number,
  ) {
    if (!admission?.broad) return undefined;
    if (this.broadReadReservations.has(admission.reservationId))
      return undefined;
    if (this.broadReadSignatures.has(admission.signature))
      return broadReadReceipt("BROAD_READ_IN_FLIGHT", admission);
    if (this.broadReadReservations.size >= maximumParallelBroadReads)
      return broadReadReceipt("PARALLEL_BROAD_READ_LIMIT", admission);
    const iterationReads = this.broadReadsByIteration.get(iteration) ?? 0;
    if (iterationReads >= maximumParallelBroadReads)
      return broadReadReceipt("ITERATION_READ_BUDGET", admission);
    this.broadReadReservations.set(
      admission.reservationId,
      admission.signature,
    );
    this.broadReadSignatures.add(admission.signature);
    this.broadReadsByIteration.set(iteration, iterationReads + 1);
    while (this.broadReadsByIteration.size > 20)
      this.broadReadsByIteration.delete(
        this.broadReadsByIteration.keys().next().value!,
      );
    return undefined;
  }

  private observeAbsentPackages<T>(result: HarnessToolResult<T>) {
    if (result.status !== "success") return;
    const diagnostics = recordValue(result.data).diagnostics;
    if (!Array.isArray(diagnostics)) return;
    for (const diagnostic of diagnostics) {
      const value = recordValue(diagnostic);
      if (value.code !== "DEPENDENCY_MISSING") continue;
      const dependency = stringValue(value.dependency);
      if (dependency) this.absentPackages.add(dependency);
    }
  }

  private reserveBlock(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    iteration: number,
  ) {
    if (iteration >= this.iterationBudget)
      return harnessError({
        code: "PRECONDITION_FAILED",
        message:
          "The tool iteration budget is exhausted. Produce the terminal answer now without another tool call.",
      });
    const remaining = this.iterationBudget - iteration;
    const finalReserve = Math.min(
      8,
      Math.max(1, Math.floor(this.iterationBudget * 0.08)),
    );
    if (remaining <= finalReserve && isExplorationOrStructural(tool, input))
      return harnessError({
        code: "PRECONDITION_FAILED",
        message:
          "The final iteration reserve is active. Only targeted edits, validation, cleanup, or finalization may continue.",
      });
    if (
      iteration >= Math.ceil(this.iterationBudget * 0.75) &&
      isStructural(tool, input)
    )
      return harnessError({
        code: "PRECONDITION_FAILED",
        message:
          "The structural strategy window is closed. Finish the current approach, validate it, and prepare the final response.",
      });
    return undefined;
  }

  private observeFailure<T>(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
  ) {
    const signature = failureSignature(tool, input);
    if (result.status === "error") {
      this.failureCounts.set(
        signature,
        (this.failureCounts.get(signature) ?? 0) + 1,
      );
      return;
    }
    this.failureCounts.delete(signature);
  }

  private observe<T>(
    state: EpochState,
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
  ) {
    if (isEdit(tool)) return observeEdit(state, result);
    if (!isRead(tool) || result.status !== "success") return;
    observeReadSignature(state, tool, input);
    state.reads += 1;
    state.readsWithoutEdit += 1;
    state.target = targetLabel(input) ?? state.target;
    if (tool !== "inspect_code") return;
    const data = recordValue(result.data);
    const overlap = numberValue(data.overlap_rate) ?? 0;
    const newBytes = numberValue(data.new_bytes) ?? 0;
    state.lowNoveltyReads =
      overlap >= 0.8 || newBytes === 0 ? state.lowNoveltyReads + 1 : 0;
  }

  private advice(state: EpochState, context: ToolContext) {
    if (!state.editApplied && state.readsWithoutEdit === 4)
      return `Four reads completed without an applied edit. If the change is clear, edit ${state.target}.`;
    if (!state.midpointAdvised && context.iteration >= this.midpoint) {
      state.midpointAdvised = true;
      return "Half of the adaptive turn budget is used. A compact continuity capsule should replace inactive technical context.";
    }
    return undefined;
  }

  private state(contextEpoch = "epoch-0") {
    const existing = this.states.get(contextEpoch);
    if (existing) return existing;
    const created = initialState();
    this.states.set(contextEpoch, created);
    if (this.states.size > 20)
      this.states.delete(this.states.keys().next().value!);
    return created;
  }
}

function observeReadSignature(
  state: EpochState,
  tool: SemanticWorkspaceToolName,
  input: unknown,
) {
  const signature = readSignature(tool, input);
  if (!signature) return;
  state.recentReadSignatures = [
    ...state.recentReadSignatures.filter((value) => value !== signature),
    signature,
  ].slice(-20);
}

function observeEdit<T>(state: EpochState, result: HarnessToolResult<T>) {
  if (result.status !== "success") return;
  const data = recordValue(result.data);
  if (data.status !== "applied") {
    return;
  }
  state.editApplied = true;
  state.readsWithoutEdit = 0;
  state.lowNoveltyReads = 0;
  state.recentReadSignatures = [];
}

function annotateEpoch<T>(
  result: HarnessToolResult<T>,
  contextEpoch: string | undefined,
  conversationId: string | undefined,
): HarnessToolResult<T> {
  if (!contextEpoch || result.status !== "success" || !isRecord(result.data))
    return result;
  return {
    ...result,
    data: {
      ...result.data,
      execution_epoch_id: contextEpoch,
      ...(conversationId ? { conversation_id: conversationId } : {}),
    },
  };
}

function broadReadReceipt(
  reason: BroadReadSuppressionReason,
  admission?: BroadReadAdmission,
) {
  const parallel = reason === "PARALLEL_BROAD_READ_LIMIT";
  const duplicate = reason === "BROAD_READ_IN_FLIGHT";
  const iterationBudget = reason === "ITERATION_READ_BUDGET";
  return harnessSuccess({
    startedAt: Date.now(),
    revision: {},
    provenance: [],
    data: broadReadReceiptData(
      reason,
      admission,
      parallel,
      duplicate,
      iterationBudget,
    ),
    diagnostics: [broadReadDiagnostic(parallel, duplicate, iterationBudget)],
    coverage: {
      scope: "unknown",
      truncated: true,
      analysis: "observed_subset",
    },
  });
}

function broadReadReceiptData(
  reason: BroadReadSuppressionReason,
  admission: BroadReadAdmission | undefined,
  parallel: boolean,
  duplicate: boolean,
  iterationBudget: boolean,
) {
  const requestedBytes = admission?.estimatedBytes ?? 0;
  return {
    status: duplicate
      ? "in_flight_reused"
      : parallel || iterationBudget
        ? "retry_suppressed"
        : "already_available",
    reason,
    content_coverage: "none",
    duplicate_broad_read_suppressed: duplicate,
    parallel_broad_read_suppressed: parallel,
    shared_iteration_budget_suppressed: iterationBudget,
    read_requested_bytes: requestedBytes,
    read_returned_bytes: 0,
    omitted_bytes: requestedBytes,
    ...broadReadRequestedSelection(admission),
    estimated_tokens_saved: Math.ceil(requestedBytes / 4),
    recommendation:
      "Use a symbol_ref, a narrow search, or one precise byte range.",
  };
}

function broadReadRequestedSelection(admission?: BroadReadAdmission) {
  return {
    ...(admission?.requestedRange
      ? { requested_range_utf8_bytes: admission.requestedRange }
      : {}),
    ...(admission?.coverageRatio !== undefined
      ? { requested_coverage_ratio: admission.coverageRatio }
      : {}),
  };
}

function broadReadDiagnostic(
  parallel: boolean,
  duplicate: boolean,
  iterationBudget: boolean,
) {
  const code = parallel
    ? "PARALLEL_BROAD_READ_SUPPRESSED"
    : duplicate
      ? "IN_FLIGHT_RESULT_ALREADY_AVAILABLE"
      : iterationBudget
        ? "ITERATION_READ_BUDGET_REUSED"
        : "RESULT_ALREADY_AVAILABLE";
  return {
    code,
    message: "The broad read was suppressed without a failed tool call.",
  };
}

function initialState(): EpochState {
  return {
    editApplied: false,
    lowNoveltyReads: 0,
    midpointAdvised: false,
    reads: 0,
    readsWithoutEdit: 0,
    recentReadSignatures: [],
    target: "the identified target",
  };
}

function readSignature(tool: SemanticWorkspaceToolName, input: unknown) {
  if (!isRead(tool)) return undefined;
  const normalized = (JSON.stringify(input) ?? "")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
  return `${tool}:${normalized}`;
}

function isRead(tool: SemanticWorkspaceToolName) {
  return [
    "get_relation_context",
    "inspect_code",
    "outline_code",
    "recall_context",
    "search_code",
    "workspace_state",
  ].includes(tool);
}

function isEdit(tool: SemanticWorkspaceToolName) {
  return [
    "create_file",
    "delete_file",
    "edit_code",
    "edit_files",
    "edit_json",
    "edit_symbol",
    "move_file",
    "patch_file",
    "replace_file",
  ].includes(tool);
}

function isBroadRead(tool: SemanticWorkspaceToolName) {
  return ["get_relation_context", "outline_code", "search_code"].includes(tool);
}

function absentPackageReceipt(dependency: string) {
  return harnessSuccess({
    startedAt: Date.now(),
    revision: {},
    provenance: [],
    data: {
      status: "unavailable",
      applied: false,
      reason: "PACKAGE_NOT_DECLARED_OR_INSTALLED",
      dependency,
      retryable: false,
      recovery_depth: 0,
      recommendation:
        "Use workspace_state dependency_inventory. Do not probe alternate node_modules paths.",
    },
    diagnostics: [
      {
        code: "ABSENT_PACKAGE_PATH_SUPPRESSED",
        message:
          "An equivalent absent-package lookup was suppressed without I/O.",
      },
    ],
  });
}

function absentPackageTarget(
  tool: SemanticWorkspaceToolName,
  input: unknown,
  dependencies: Set<string>,
) {
  for (const dependency of dependencies) {
    if (packageLookupTool(tool) && explicitNodeModulesAccess(input, dependency))
      return dependency;
    if (dependencyOperation(tool, input, dependency)) return dependency;
  }
  return undefined;
}

function packageLookupTool(tool: SemanticWorkspaceToolName) {
  return [
    "get_relation_context",
    "inspect_code",
    "outline_code",
    "search_code",
  ].includes(tool);
}

function explicitNodeModulesAccess(
  value: unknown,
  dependency: string,
): boolean {
  if (typeof value === "string") {
    const normalized = value.replaceAll("\\", "/").toLowerCase();
    const path = `node_modules/${dependency.toLowerCase()}`;
    return (
      normalized === path ||
      normalized.includes(`/${path}/`) ||
      normalized.endsWith(`/${path}`) ||
      normalized.startsWith(`${path}/`)
    );
  }
  if (Array.isArray(value))
    return value.some((item) => explicitNodeModulesAccess(item, dependency));
  return Object.values(recordValue(value)).some((item) =>
    explicitNodeModulesAccess(item, dependency),
  );
}

function dependencyOperation(
  tool: SemanticWorkspaceToolName,
  input: unknown,
  dependency: string,
) {
  if (tool !== "mutate_dependencies") return false;
  const operations = recordValue(input).operations;
  if (!Array.isArray(operations)) return false;
  return operations.some(
    (operation) => recordValue(operation).name === dependency,
  );
}

function isStructural(tool: SemanticWorkspaceToolName, input: unknown) {
  if (
    ["create_file", "delete_file", "move_file", "mutate_dependencies"].includes(
      tool,
    )
  )
    return true;
  if (!["apply_change", "edit_code", "edit_files"].includes(tool)) return false;
  return containedOperations(input).some((operation) =>
    ["create_file", "delete_file", "move_file"].includes(operation),
  );
}

function containedOperations(input: unknown) {
  const value = recordValue(input);
  const operations = Array.isArray(value.edits)
    ? value.edits
    : Array.isArray(value.operations)
      ? value.operations
      : [];
  return operations.flatMap((operation) => {
    const record = recordValue(operation);
    const value = record.operation ?? record.kind;
    return typeof value === "string" ? [value] : [];
  });
}

function isExplorationOrStructural(
  tool: SemanticWorkspaceToolName,
  input: unknown,
) {
  return (
    isStructural(tool, input) ||
    ["get_relation_context", "outline_code", "search_code"].includes(tool)
  );
}

function failureSignature(tool: SemanticWorkspaceToolName, input: unknown) {
  return `${tool}:${JSON.stringify(input) ?? ""}`;
}

function targetLabel(input: unknown) {
  const value = recordValue(input);
  const target = recordValue(value.target);
  if (typeof target.symbol_ref === "string") return "the active symbol";
  if (typeof target.node_ref === "string") return "the active syntax node";
  if (typeof target.path === "string") return target.path;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
