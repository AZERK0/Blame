import type { HarnessToolObservation } from "./tool-observability.js";

export type HarnessModelIteration = {
  context_tokens: number;
  duration_ms: number;
  iteration: number;
};

export type HarnessSubmissionObservation = {
  outcome: "accepted" | "blocked" | "repair_required";
};

export function harnessBenchmarkMetrics(input: {
  model_iterations?: HarnessModelIteration[];
  submissions?: HarnessSubmissionObservation[];
  tools: HarnessToolObservation[];
}) {
  const tools = chronological(input.tools);
  const modelIterations = input.model_iterations ?? [];
  const submissions = input.submissions ?? [];
  const failures = tools.filter(({ error_signature }) => error_signature);
  const reads = tools.filter(({ tool }) => readTools.has(tool));
  const repeatedReads = duplicateCalls(reads);
  const firstMutation = tools.find(successfulMutation);
  return {
    time_before_first_mutation_ms: elapsedUntil(tools, firstMutation),
    repeated_read_rate: ratio(repeatedReads, reads.length),
    tool_rejection_rate: ratio(tools.filter(rejectedTool).length, tools.length),
    identical_validations_avoided: tools.filter(
      ({ tool, cache_usage }) => tool === "run_task" && cache_usage.hit,
    ).length,
    tool_time_ms: tools.reduce((total, tool) => total + tool.duration, 0),
    model_time_ms: modelIterations.reduce(
      (total, iteration) => total + iteration.duration_ms,
      0,
    ),
    context_tokens_per_iteration: modelIterations.map(
      ({ context_tokens, iteration }) => ({ context_tokens, iteration }),
    ),
    maximum_context_tokens: Math.max(
      0,
      ...modelIterations.map(({ context_tokens }) => context_tokens),
    ),
    environment_repairs: tools.filter(({ environment_repair }) =>
      Boolean(environment_repair),
    ).length,
    classified_failure_rate: ratio(
      failures.filter(({ result_cause }) => result_cause !== "none").length,
      failures.length,
    ),
    valid_submission_rate: ratio(
      submissions.filter(({ outcome }) => outcome === "accepted").length,
      submissions.length,
    ),
  };
}

function duplicateCalls(tools: HarnessToolObservation[]) {
  const identities = new Set<string>();
  let duplicates = 0;
  for (const tool of tools) {
    const identity = `${tool.tool}\0${tool.source_revision_id}\0${tool.environment_revision_id}\0${tool.normalized_input_digest}`;
    if (identities.has(identity)) duplicates += 1;
    identities.add(identity);
  }
  return duplicates;
}

function successfulMutation(tool: HarnessToolObservation) {
  return mutationTools.has(tool.tool) && tool.effect === "changed";
}

function rejectedTool(tool: HarnessToolObservation) {
  return ["harness_limitation", "invalid_input"].includes(tool.result_cause);
}

function elapsedUntil(
  tools: HarnessToolObservation[],
  selected?: HarnessToolObservation,
) {
  if (!tools.length || !selected) return null;
  return Math.max(
    0,
    Date.parse(selected.started_at) - Date.parse(tools[0]!.started_at),
  );
}

function chronological(tools: HarnessToolObservation[]) {
  return [...tools].sort((left, right) =>
    left.started_at.localeCompare(right.started_at),
  );
}

function ratio(numerator: number, denominator: number) {
  return denominator ? numerator / denominator : 0;
}

const readTools = new Set([
  "workspace_state",
  "search_code",
  "outline_code",
  "inspect_code",
  "get_relation_context",
  "inspect_run",
  "review_change",
  "inspect_artifact",
  "recall_context",
]);

const mutationTools = new Set([
  "edit_code",
  "edit_files",
  "edit_symbol",
  "edit_json",
  "patch_file",
  "create_file",
  "replace_file",
  "delete_file",
  "move_file",
  "mutate_dependencies",
  "apply_change",
]);
