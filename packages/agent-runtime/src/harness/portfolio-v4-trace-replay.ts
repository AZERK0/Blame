import type { HarnessReplayEvent } from "./harness-v2-benchmark.js";

type TraceRecord = {
  attributes?: Record<string, unknown>;
  event_name?: string;
  timestamp?: string;
};

export type PortfolioV4TraceSummary = {
  activities: number;
  applyChangeCalls: number;
  commitCalls: number;
  firstEditMs: number;
  inspectCalls: number;
  maxContextTokens: number;
  modelTurns: number;
  previewRecoveries: number;
  proposalCalls: number;
  reviewCalls: number;
  searchCalls: number;
  stories: string[];
};

export const portfolioV4ObservedTraceSummary: PortfolioV4TraceSummary = {
  activities: 600,
  applyChangeCalls: 97,
  commitCalls: 30,
  firstEditMs: 1_080_000,
  inspectCalls: 117,
  maxContextTokens: 668_748,
  modelTurns: 324,
  previewRecoveries: 89,
  proposalCalls: 67,
  reviewCalls: 32,
  searchCalls: 124,
  stories: ["US3", "US4", "US5", "US6"],
};

export function replayHarnessTraceJsonl(source: string) {
  const records = source
    .split(/\r?\n/)
    .map(parseTraceLine)
    .filter((record): record is TraceRecord => record !== undefined);
  const firstTimestamp = Math.min(
    ...records.map(recordTimestamp).filter(Number.isFinite),
  );
  return records.flatMap((record, index) =>
    replayRecord(record, index, firstTimestamp),
  );
}

function parseTraceLine(line: string) {
  const objectStart = line.indexOf("{");
  if (objectStart < 0) return undefined;
  try {
    return JSON.parse(line.slice(objectStart)) as TraceRecord;
  } catch {
    return undefined;
  }
}

function replayRecord(
  record: TraceRecord,
  index: number,
  firstTimestamp: number,
): HarnessReplayEvent[] {
  const atMs = Math.max(0, recordTimestamp(record) - firstTimestamp);
  if (record.event_name === "blame.agent.event_usage")
    return usageEvents(record.attributes, atMs);
  if (record.event_name === "blame.agent.event_tool")
    return toolEvents(record.attributes, atMs, index);
  if (record.event_name === "blame.agent.event_done")
    return [{ at_ms: atMs, type: "session_end" }];
  return retryEvents(record, atMs);
}

function usageEvents(
  attributes: Record<string, unknown> | undefined,
  atMs: number,
): HarnessReplayEvent[] {
  const inputTokens = numberValue(attributes?.inputTokens);
  const cacheTokens = numberValue(attributes?.cacheReadTokens);
  return [
    {
      at_ms: atMs,
      context_tokens: inputTokens + cacheTokens,
      input_tokens: inputTokens,
      type: "model_turn",
    },
  ];
}

function toolEvents(
  attributes: Record<string, unknown> | undefined,
  atMs: number,
  index: number,
): HarnessReplayEvent[] {
  if (attributes?.status !== "finished") return [];
  const tool = stringValue(attributes.toolName) ?? "unknown";
  if (isReadTool(tool)) return [readEvent(attributes, atMs, index)];
  if (isEditTool(tool)) return [editEvent(attributes, atMs, tool)];
  if (tool === "run_task") return [runEvent(attributes, atMs, index)];
  return [];
}

function readEvent(
  attributes: Record<string, unknown>,
  atMs: number,
  index: number,
): HarnessReplayEvent {
  const returnedBytes = optionalNumber(attributes.read_returned_bytes);
  return {
    at_ms: atMs,
    blob: stringValue(attributes.blob_hash) ?? `unmeasured-${index}`,
    context_epoch: stringValue(attributes.execution_epoch_id) ?? "legacy",
    range: byteRange(attributes, returnedBytes ?? 0),
    requested_bytes: optionalNumber(attributes.read_requested_bytes),
    ...(returnedBytes !== undefined ? { returned_bytes: returnedBytes } : {}),
    type: "read",
  };
}

function editEvent(
  attributes: Record<string, unknown>,
  atMs: number,
  tool: string,
): HarnessReplayEvent {
  return {
    at_ms: atMs,
    correct: optionalBoolean(attributes.edit_correct),
    outcome: editOutcome(attributes.edit_outcome),
    tool,
    type: "edit",
  };
}

function runEvent(
  attributes: Record<string, unknown>,
  atMs: number,
  index: number,
): HarnessReplayEvent {
  return {
    at_ms: atMs,
    run_ref: stringValue(attributes.run_ref) ?? `run-${index}`,
    status: runStatus(attributes.run_status),
    type: "run_task",
  };
}

function retryEvents(record: TraceRecord, atMs: number): HarnessReplayEvent[] {
  if (record.event_name !== "blame.harness.tool_retry") return [];
  return [
    {
      at_ms: atMs,
      tool: stringValue(record.attributes?.toolName) ?? "unknown",
      type: "tool_retry",
    },
  ];
}

function byteRange(
  attributes: Record<string, unknown>,
  returnedBytes: number,
): [number, number] {
  const start = numberValue(attributes.range_start);
  const end = optionalNumber(attributes.range_end);
  return [start, end ?? start + returnedBytes];
}

function editOutcome(value: unknown) {
  return ["applied", "conflict", "validation_failed"].includes(String(value))
    ? (value as "applied" | "conflict" | "validation_failed")
    : "applied";
}

function runStatus(value: unknown) {
  const status = String(value);
  if (
    [
      "running",
      "passed",
      "failed",
      "timed_out",
      "cancelled",
      "runtime_error",
    ].includes(status)
  )
    return status as Extract<
      HarnessReplayEvent,
      { type: "run_task" }
    >["status"];
  return "runtime_error";
}

function isReadTool(tool: string) {
  return ["inspect_code", "outline_code", "search_code"].includes(tool);
}

function isEditTool(tool: string) {
  return [
    "apply_change",
    "commit_proposal",
    "edit_code",
    "propose",
    "review_change",
  ].includes(tool);
}

function recordTimestamp(record: TraceRecord) {
  const timestamp = Date.parse(record.timestamp ?? "");
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function optionalBoolean(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
