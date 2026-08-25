import { harnessError, type HarnessToolResult } from "./protocol.js";
import type { SemanticWorkspaceToolName } from "./semantic-executor.js";

type ToolContext = {
  conversationId?: string;
  contextEpoch?: string;
  iteration: number;
};

type EpochState = {
  duplicateReads: number;
  editApplied: boolean;
  editConflicts: number;
  firstActivityAt: number;
  firstAppliedEditAt?: number;
  lowNoveltyReads: number;
  midpointAdvised: boolean;
  readRequestedBytes: number;
  readReturnedBytes: number;
  reads: number;
  readsAfterEdit: number;
  readsWithoutEdit: number;
  retries: number;
  similarReads: number;
  recentReadSignatures: string[];
  target: string;
};

export class HarnessCostGovernor {
  private readonly midpoint: number;
  private readonly states = new Map<string, EpochState>();
  private readonly taskState = initialState();

  constructor(iterationBudget = 80) {
    this.midpoint = Math.max(1, Math.ceil(iterationBudget / 2));
  }

  before(
    tool: SemanticWorkspaceToolName,
    contextEpoch?: string,
    input?: unknown,
  ) {
    this.state(contextEpoch);
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
    this.observe(state, tool, input, result);
    this.observe(this.taskState, tool, input, result);
    const enriched = enrichEpoch(
      result,
      context.contextEpoch,
      context.conversationId,
      state,
      this.taskState,
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
    state.readsAfterEdit += Number(state.editApplied);
    state.target = targetLabel(input) ?? state.target;
    if (tool !== "inspect_code") return;
    const data = recordValue(result.data);
    const overlap = numberValue(data.overlap_rate) ?? 0;
    const newBytes = numberValue(data.new_bytes) ?? 0;
    const requested = rangeBytes(data.range_utf8_bytes);
    state.readRequestedBytes += requested;
    state.readReturnedBytes += newBytes;
    state.duplicateReads += Number(data.status === "already_available");
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
  state.similarReads += Number(state.recentReadSignatures.includes(signature));
  state.recentReadSignatures = [
    ...state.recentReadSignatures.filter((value) => value !== signature),
    signature,
  ].slice(-20);
}

function observeEdit<T>(state: EpochState, result: HarnessToolResult<T>) {
  if (result.status !== "success") return;
  const data = recordValue(result.data);
  if (data.status !== "applied") {
    state.editConflicts += Number(data.status === "conflict");
    return;
  }
  state.editApplied = true;
  state.firstAppliedEditAt ??= Date.now();
  state.readsWithoutEdit = 0;
  state.lowNoveltyReads = 0;
  state.retries += numberValue(data.internal_retries) ?? 0;
}

function enrichEpoch<T>(
  result: HarnessToolResult<T>,
  contextEpoch: string | undefined,
  conversationId: string | undefined,
  state: EpochState,
  taskState: EpochState,
): HarnessToolResult<T> {
  if (!contextEpoch || result.status !== "success" || !isRecord(result.data))
    return result;
  return {
    ...result,
    data: {
      ...result.data,
      execution_epoch_id: contextEpoch,
      ...(conversationId ? { conversation_id: conversationId } : {}),
      governor: publicMetrics(state),
      task_governor: publicMetrics(taskState),
    },
  };
}

function publicMetrics(state: EpochState) {
  return {
    read_call_count: state.reads,
    read_requested_bytes: state.readRequestedBytes,
    read_returned_bytes: state.readReturnedBytes,
    read_suppressed_bytes: Math.max(
      0,
      state.readRequestedBytes - state.readReturnedBytes,
    ),
    duplicate_read_count: state.duplicateReads,
    edit_conflict_count: state.editConflicts,
    tool_retry_count: state.retries,
    similar_read_count: state.similarReads,
    reads_after_edit: state.readsAfterEdit,
    time_to_first_applied_edit: state.firstAppliedEditAt
      ? state.firstAppliedEditAt - state.firstActivityAt
      : null,
  };
}

function initialState(): EpochState {
  return {
    duplicateReads: 0,
    editApplied: false,
    editConflicts: 0,
    firstActivityAt: Date.now(),
    lowNoveltyReads: 0,
    midpointAdvised: false,
    readRequestedBytes: 0,
    readReturnedBytes: 0,
    reads: 0,
    readsAfterEdit: 0,
    readsWithoutEdit: 0,
    retries: 0,
    similarReads: 0,
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

function targetLabel(input: unknown) {
  const value = recordValue(input);
  const target = recordValue(value.target);
  if (typeof target.symbol_ref === "string") return "the active symbol";
  if (typeof target.node_ref === "string") return "the active syntax node";
  if (typeof target.path === "string") return target.path;
  return undefined;
}

function rangeBytes(value: unknown) {
  if (!Array.isArray(value) || value.length !== 2) return 0;
  const start = numberValue(value[0]) ?? 0;
  const end = numberValue(value[1]) ?? start;
  return Math.max(0, end - start);
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
