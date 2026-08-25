export type HarnessReplayEvent =
  | {
      at_ms: number;
      context_tokens: number;
      input_tokens?: number;
      type: "model_turn";
    }
  | {
      at_ms: number;
      blob: string;
      context_epoch: string;
      range: [number, number];
      requested_bytes?: number;
      returned_bytes?: number;
      type: "read";
    }
  | {
      at_ms: number;
      correct?: boolean;
      outcome?: "applied" | "conflict" | "validation_failed";
      tool: string;
      type: "edit";
    }
  | { at_ms: number; fingerprint: string; type: "preview_recovery" }
  | { at_ms: number; tool: string; type: "tool_retry" }
  | {
      at_ms: number;
      fact_id: string;
      preserved: boolean;
      type: "constraint_check";
    }
  | {
      at_ms: number;
      run_ref: string;
      status:
        | "running"
        | "passed"
        | "failed"
        | "timed_out"
        | "cancelled"
        | "runtime_error";
      type: "run_task";
    }
  | { at_ms: number; type: "session_end" };

export type HarnessReplayMetrics = ReturnType<typeof harnessReplayMetrics>;

export function harnessReplayMetrics(events: HarnessReplayEvent[]) {
  const accumulated = accumulateReplay(events);
  const firstEdit = firstAppliedEdit(events);
  const contextTokens = modelTurns(events).map((event) => event.context_tokens);
  const checkedConstraints = constraintChecks(events);
  const reads = readEvents(events);
  const measuredReads = reads.filter(
    (event) => event.returned_bytes !== undefined,
  ).length;
  return {
    accumulated_input_tokens: modelTurns(events).reduce(
      (sum, event) => sum + (event.input_tokens ?? event.context_tokens),
      0,
    ),
    calls_before_first_edit: callsBefore(events, firstEdit?.at_ms),
    constraint_compliance_rate: ratio(
      checkedConstraints.filter((event) => event.preserved).length,
      checkedConstraints.length,
      1,
    ),
    edit_conflicts: accumulated.editConflicts,
    first_edit_ms: firstEdit?.at_ms ?? null,
    identical_reads: accumulated.identicalReads,
    incorrect_edit_rate: ratio(
      accumulated.incorrectEdits,
      accumulated.checkedEdits,
      0,
    ),
    max_context_tokens: Math.max(0, ...contextTokens),
    missing_terminal_runs: [...accumulated.runs.values()].filter(
      (run) => run.status === "running",
    ).length,
    proposal_protocol_edits: proposalProtocolEdits(events),
    read_byte_measurements: measuredReads,
    read_bytes_complete: measuredReads === reads.length,
    read_calls: reads.length,
    read_returned_bytes: accumulated.readReturnedBytes,
    repeated_preview_recoveries: [
      ...accumulated.previewFailures.values(),
    ].filter((count) => count > 1).length,
    tool_retries: events.filter((event) => event.type === "tool_retry").length,
    total_duration_ms: replayDuration(events),
  };
}

export function harnessReplayComparison(
  beforeEvents: HarnessReplayEvent[],
  afterEvents: HarnessReplayEvent[],
) {
  const before = harnessReplayMetrics(beforeEvents);
  const after = harnessReplayMetrics(afterEvents);
  const inputReduction = reduction(
    before.accumulated_input_tokens,
    after.accumulated_input_tokens,
  );
  const byteReduction = reduction(
    before.read_returned_bytes,
    after.read_returned_bytes,
  );
  return {
    after,
    before,
    goals: {
      code_bytes_reduced_by_half:
        before.read_bytes_complete &&
        after.read_bytes_complete &&
        byteReduction >= 0.5,
      constraints_preserved:
        after.constraint_compliance_rate >= before.constraint_compliance_rate,
      context_reduced_by_forty_percent: inputReduction >= 0.4,
      first_edit_under_eight_calls:
        after.first_edit_ms !== null &&
        (after.calls_before_first_edit ?? Number.POSITIVE_INFINITY) < 8,
      incorrect_edit_rate_not_increased:
        after.incorrect_edit_rate <= before.incorrect_edit_rate,
      no_consecutive_full_read: after.identical_reads === 0,
    },
    reductions: {
      accumulated_input_tokens: inputReduction,
      read_returned_bytes: byteReduction,
    },
  };
}

export function harnessV2ReplayPasses(events: HarnessReplayEvent[]) {
  const metrics = harnessReplayMetrics(events);
  return {
    metrics,
    passed:
      metrics.proposal_protocol_edits === 0 &&
      metrics.identical_reads === 0 &&
      metrics.max_context_tokens <= 160_000 &&
      metrics.repeated_preview_recoveries === 0 &&
      metrics.missing_terminal_runs === 0 &&
      metrics.first_edit_ms !== null &&
      metrics.first_edit_ms < 120_000 &&
      (metrics.calls_before_first_edit ?? Number.POSITIVE_INFINITY) < 8 &&
      metrics.constraint_compliance_rate === 1 &&
      metrics.incorrect_edit_rate === 0,
  };
}

function accumulateReplay(events: HarnessReplayEvent[]) {
  return events.reduce(updateAccumulator, initialAccumulator());
}

function initialAccumulator() {
  return {
    checkedEdits: 0,
    editConflicts: 0,
    identicalReads: 0,
    incorrectEdits: 0,
    previewFailures: new Map<string, number>(),
    readReturnedBytes: 0,
    reads: new Set<string>(),
    runs: new Map<string, HarnessReplayEvent & { type: "run_task" }>(),
  };
}

function updateAccumulator(
  accumulator: ReturnType<typeof initialAccumulator>,
  event: HarnessReplayEvent,
) {
  if (event.type === "read") updateReadAccumulator(accumulator, event);
  if (event.type === "edit") updateEditAccumulator(accumulator, event);
  if (event.type === "preview_recovery")
    accumulator.previewFailures.set(
      event.fingerprint,
      (accumulator.previewFailures.get(event.fingerprint) ?? 0) + 1,
    );
  if (event.type === "run_task") accumulator.runs.set(event.run_ref, event);
  return accumulator;
}

function updateReadAccumulator(
  accumulator: ReturnType<typeof initialAccumulator>,
  event: Extract<HarnessReplayEvent, { type: "read" }>,
) {
  const key = readKey(event);
  if (accumulator.reads.has(key)) accumulator.identicalReads += 1;
  accumulator.reads.add(key);
  accumulator.readReturnedBytes +=
    event.returned_bytes ?? rangeLength(event.range);
}

function updateEditAccumulator(
  accumulator: ReturnType<typeof initialAccumulator>,
  event: Extract<HarnessReplayEvent, { type: "edit" }>,
) {
  if (event.outcome === "conflict") accumulator.editConflicts += 1;
  if (event.correct !== undefined) accumulator.checkedEdits += 1;
  if (event.correct === false) accumulator.incorrectEdits += 1;
}

function callsBefore(events: HarnessReplayEvent[], firstEditAt?: number) {
  if (firstEditAt === undefined) return null;
  return events.filter(
    (event) =>
      event.at_ms < firstEditAt &&
      !["constraint_check", "model_turn", "session_end"].includes(event.type),
  ).length;
}

function constraintChecks(events: HarnessReplayEvent[]) {
  return events.filter(
    (
      event,
    ): event is Extract<HarnessReplayEvent, { type: "constraint_check" }> =>
      event.type === "constraint_check",
  );
}

function firstAppliedEdit(events: HarnessReplayEvent[]) {
  return events
    .filter(
      (event): event is Extract<HarnessReplayEvent, { type: "edit" }> =>
        event.type === "edit" &&
        (event.outcome === undefined || event.outcome === "applied"),
    )
    .sort((left, right) => left.at_ms - right.at_ms)[0];
}

function modelTurns(events: HarnessReplayEvent[]) {
  return events.filter(
    (event): event is Extract<HarnessReplayEvent, { type: "model_turn" }> =>
      event.type === "model_turn",
  );
}

function readEvents(events: HarnessReplayEvent[]) {
  return events.filter(
    (event): event is Extract<HarnessReplayEvent, { type: "read" }> =>
      event.type === "read",
  );
}

function proposalProtocolEdits(events: HarnessReplayEvent[]) {
  return events.filter(
    (event) =>
      event.type === "edit" &&
      ["propose", "review_change", "commit_proposal"].includes(event.tool),
  ).length;
}

function rangeLength(range: [number, number]) {
  return Math.max(0, range[1] - range[0]);
}

function readKey(event: Extract<HarnessReplayEvent, { type: "read" }>) {
  return `${event.context_epoch}\0${event.blob}\0${event.range[0]}\0${event.range[1]}`;
}

function ratio(numerator: number, denominator: number, emptyValue: number) {
  return denominator === 0 ? emptyValue : numerator / denominator;
}

function reduction(before: number, after: number) {
  return before === 0 ? 0 : (before - after) / before;
}

function replayDuration(events: HarnessReplayEvent[]) {
  if (events.length === 0) return 0;
  const times = events.map((event) => event.at_ms);
  return Math.max(...times) - Math.min(...times);
}
