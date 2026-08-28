import {
  harnessError,
  harnessSuccess,
  type HarnessToolResult,
} from "./protocol.js";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";
import { SemanticLoopDetector } from "./semantic-loop-detector.js";
import type { RawReadProfile } from "./code-navigation-policy.js";

type ToolContext = {
  conversationId?: string;
  contextEpoch?: string;
  iteration: number;
};

type BroadReadSuppressionReason =
  | "BROAD_READ_ALREADY_AVAILABLE"
  | "BROAD_READ_IN_FLIGHT";

export type BroadReadAdmission = RawReadProfile & {
  reservationId: string;
  signature: string;
};

type EpochState = {
  editApplied: boolean;
  facts: string[];
  firstEditIteration?: number;
  lastMaterialProgressIteration: number;
  lowNoveltyReads: number;
  midpointAdvised: boolean;
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
  private readonly absentPackages = new Set<string>();
  private readonly states = new Map<string, EpochState>();
  private readonly taskState = initialState();
  private identicalOrCoveredReads = 0;
  private unavailableCapabilities = new Set<string>();
  private latestIteration = 0;

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
    this.latestIteration = Math.max(this.latestIteration, iteration);
    const reserveBlock = this.reserveBlock(this.latestIteration);
    if (reserveBlock) return reserveBlock;
    const absentPackage = absentPackageTarget(tool, input, this.absentPackages);
    if (absentPackage) return absentPackageReceipt(absentPackage);
    const loopDecision = this.loops?.before(tool, input);
    if (loopDecision) return loopDecision;
    if (
      (this.failureCounts.get(failureSignature(tool, input, contextEpoch)) ??
        0) >= 3
    )
      return harnessError({
        code: "PRECONDITION_FAILED",
        message:
          "This identical tool request failed three times. Stop retrying it and use the remaining turn for validation, cleanup, and the final response.",
      });
    const state = this.taskState;
    const signature = readSignature(tool, input);
    if (
      (admission?.broad || isBroadRead(tool)) &&
      signature &&
      state.recentReadSignatures.includes(signature)
    )
      return broadReadReceipt("BROAD_READ_ALREADY_AVAILABLE", admission);
    return this.reserveBroadRead(admission);
  }

  after<T>(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
    context: ToolContext,
  ) {
    this.latestIteration = Math.max(this.latestIteration, context.iteration);
    const state = this.state(context.contextEpoch);
    this.loops?.after(tool, input, result);
    this.observe(state, tool, input, result);
    this.observe(this.taskState, tool, input, result);
    this.observeMaterialProgress(state, tool, input, result, context.iteration);
    this.observeMaterialProgress(
      this.taskState,
      tool,
      input,
      result,
      context.iteration,
    );
    this.observeFailure(tool, input, result, context.contextEpoch);
    this.observeAbsentPackages(result);
    const enriched = annotateProgressMetrics(
      annotateEpoch(result, context.contextEpoch, context.conversationId),
      this.metrics(context.iteration),
    );
    const advice = this.advice(this.taskState, context);
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
    Object.assign(this.taskState, initialState());
    this.identicalOrCoveredReads = 0;
    this.unavailableCapabilities = new Set<string>();
    this.failureCounts.clear();
    this.absentPackages.clear();
    this.broadReadReservations.clear();
    this.broadReadSignatures.clear();
    this.latestIteration = 0;
  }

  metrics(iteration = 0) {
    const effectiveIteration = Math.max(this.latestIteration, iteration);
    const noProgressIterations = this.noProgressIterations(effectiveIteration);
    return {
      first_edit_iteration: this.taskState.firstEditIteration,
      no_progress_iterations: noProgressIterations,
      identical_or_covered_reads: this.identicalOrCoveredReads,
      unavailable_capabilities: [...this.unavailableCapabilities],
      alerts: [
        ...(noProgressIterations >= 8 && !this.taskState.editApplied
          ? ["NO_MUTATION_AFTER_8_ITERATIONS"]
          : []),
      ],
    };
  }

  releaseBroadRead(reservationId?: string) {
    if (!reservationId) return;
    const signature = this.broadReadReservations.get(reservationId);
    this.broadReadReservations.delete(reservationId);
    if (signature) this.broadReadSignatures.delete(signature);
  }

  private reserveBroadRead(admission: BroadReadAdmission | undefined) {
    if (!admission?.broad) return undefined;
    if (this.broadReadReservations.has(admission.reservationId))
      return undefined;
    if (this.broadReadSignatures.has(admission.signature))
      return broadReadReceipt("BROAD_READ_IN_FLIGHT", admission);
    this.broadReadReservations.set(
      admission.reservationId,
      admission.signature,
    );
    this.broadReadSignatures.add(admission.signature);
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

  private observeMaterialProgress<T>(
    state: EpochState,
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
    iteration: number,
  ) {
    if (result.outcome === "unavailable") {
      this.unavailableCapabilities.add(result.reason);
    }
    if (tool === "mutate_dependencies" && result.outcome === "applied")
      removeMutatedPackages(this.absentPackages, input);
    if (!materialProgress(tool, result, state)) return;
    this.failureCounts.clear();
    state.lastMaterialProgressIteration = iteration;
    if (isEdit(tool) && result.outcome === "applied") {
      state.firstEditIteration ??= iteration;
      state.editApplied = true;
    }
  }

  private reserveBlock(iteration: number) {
    if (iteration >= this.iterationBudget)
      return harnessError({
        code: "PRECONDITION_FAILED",
        message:
          "The tool iteration budget is exhausted. Produce the terminal answer now without another tool call.",
      });
    return undefined;
  }

  private observeFailure<T>(
    tool: SemanticWorkspaceToolName,
    input: unknown,
    result: HarnessToolResult<T>,
    contextEpoch?: string,
  ) {
    const signature = failureSignature(tool, input, contextEpoch);
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
    state.target = targetLabel(input) ?? state.target;
    state.facts = compactFacts(state.facts, tool, input, result);
    if (result.outcome === "skipped") this.identicalOrCoveredReads += 1;
    if (tool !== "inspect_code") return;
    const data = recordValue(result.data);
    const overlap = numberValue(data.overlap_rate) ?? 0;
    const newBytes = numberValue(data.new_bytes) ?? 0;
    state.lowNoveltyReads =
      overlap >= 0.8 || newBytes === 0 ? state.lowNoveltyReads + 1 : 0;
  }

  private advice(state: EpochState, context: ToolContext) {
    if (state.lowNoveltyReads === 2)
      return `Recent inspections added little new evidence. Known facts: ${
        state.facts.join("; ") || "the current target is identified"
      }. Prefer the smallest unresolved symbol or edit ${state.target} when the change is supported.`;
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

  private noProgressIterations(iteration: number) {
    return Math.max(
      0,
      Math.max(0, iteration) - this.taskState.lastMaterialProgressIteration,
    );
  }
}

function annotateProgressMetrics<T>(
  result: HarnessToolResult<T>,
  metrics: ReturnType<HarnessCostGovernor["metrics"]>,
): HarnessToolResult<T> {
  if (
    result.status !== "success" ||
    result.outcome === "unavailable" ||
    !isRecord(result.data)
  )
    return result;
  return {
    ...result,
    data: {
      ...result.data,
      progress_governor: metrics,
    },
  } as HarnessToolResult<T>;
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
  override?: { reason: string; recommendation: string },
) {
  const duplicate = reason === "BROAD_READ_IN_FLIGHT";
  return harnessSuccess({
    startedAt: Date.now(),
    revision: {},
    provenance: [],
    data: broadReadReceiptData(reason, admission, duplicate, override),
    diagnostics: [broadReadDiagnostic(duplicate)],
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
  duplicate: boolean,
  override?: { reason: string; recommendation: string },
) {
  const requestedBytes = admission?.estimatedBytes ?? 0;
  return {
    status: duplicate ? "in_flight_reused" : "already_available",
    reason: override?.reason ?? reason,
    content_coverage: "none",
    duplicate_broad_read_suppressed: duplicate,
    parallel_broad_read_suppressed: false,
    shared_iteration_budget_suppressed: false,
    read_requested_bytes: requestedBytes,
    read_returned_bytes: 0,
    omitted_bytes: requestedBytes,
    ...broadReadRequestedSelection(admission),
    estimated_tokens_saved: Math.ceil(requestedBytes / 4),
    recommendation:
      override?.recommendation ??
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

function broadReadDiagnostic(duplicate: boolean) {
  const code = duplicate
    ? "IN_FLIGHT_RESULT_ALREADY_AVAILABLE"
    : "RESULT_ALREADY_AVAILABLE";
  return {
    code,
    message: "The broad read was suppressed without a failed tool call.",
  };
}

function initialState(): EpochState {
  return {
    editApplied: false,
    facts: [],
    lastMaterialProgressIteration: 0,
    lowNoveltyReads: 0,
    midpointAdvised: false,
    recentReadSignatures: [],
    target: "the identified target",
  };
}

function materialProgress<T>(
  tool: SemanticWorkspaceToolName,
  result: HarnessToolResult<T>,
  state: EpochState,
) {
  if (result.outcome === "applied") return true;
  if (result.outcome === "blocked") return true;
  if (
    result.outcome === "unavailable" &&
    result.recommendation.toLowerCase().includes("report")
  )
    return true;
  if (tool === "run_task" && state.editApplied)
    return result.status === "success" || !result.fatal;
  return false;
}

function compactFacts<T>(
  current: string[],
  tool: SemanticWorkspaceToolName,
  input: unknown,
  result: HarnessToolResult<T>,
) {
  const data = result.status === "success" ? recordValue(result.data) : {};
  const target =
    stringValue(data.path) ??
    targetLabel(input) ??
    stringValue(data.reason) ??
    tool;
  const fact = `${tool}: ${target} (${result.outcome})`;
  return [...current.filter((value) => value !== fact), fact].slice(-6);
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
    "apply_change",
    "create_file",
    "delete_file",
    "edit_code",
    "edit_files",
    "edit_json",
    "edit_symbol",
    "move_file",
    "mutate_dependencies",
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

function removeMutatedPackages(dependencies: Set<string>, input: unknown) {
  const operations = recordValue(input).operations;
  if (!Array.isArray(operations)) return;
  for (const operation of operations) {
    const dependency = stringValue(recordValue(operation).name);
    if (dependency) dependencies.delete(dependency);
  }
}

function failureSignature(
  tool: SemanticWorkspaceToolName,
  input: unknown,
  contextEpoch?: string,
) {
  return `${contextEpoch ?? "epoch-0"}:${tool}:${JSON.stringify(input) ?? ""}`;
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
