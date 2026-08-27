import { harnessError, type HarnessToolResult } from "./protocol.js";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";
import { SemanticLoopDetector } from "./semantic-loop-detector.js";

type ToolContext = {
  conversationId?: string;
  contextEpoch?: string;
  iteration: number;
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
  ) {
    this.state(contextEpoch);
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
      isBroadRead(tool) &&
      ((state.readsWithoutEdit >= 4 && state.lowNoveltyReads >= 2) ||
        (signature && state.recentReadSignatures.includes(signature)))
    )
      return harnessError({
        code: "PRECONDITION_FAILED",
        message: `The requested areas are already present in the active context. The relevant target is ${state.target}. Apply a targeted edit or request one narrow missing range.`,
        recovery: { recommended_tool: "edit_code", target: state.target },
      });
    return undefined;
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
  return tool === "outline_code" || tool === "search_code";
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
