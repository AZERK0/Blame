import assert from "node:assert/strict";
import test from "node:test";
import {
  EvidencePlanner,
  ExecutionLifecycle,
  ExecutionTerminator,
  ProjectionEngine,
  RetryLedger,
  SingleExecutionAuthority,
  InMemoryStateAuthority,
  aggregateEditGroupReceipts,
  buildPathDependencyGroups,
  capabilitySnapshot,
  completionLifecycleTerminal,
  completedResult,
  deriveCompletionDecision,
  evaluateReleaseGates,
  initialReleaseThresholds,
  isHarnessResult,
  resolveSemanticCandidate,
  semanticRebasePolicyVersion,
  type EditGroupReceipt,
  type EvidencePlannerInput,
  type Provenance,
} from "./index.js";

const provenance: Provenance = {
  source_revision_id: "src_current",
  environment_revision_id: "env_current",
  execution_id: "execution-1",
  tool_call_id: "tool-1",
  produced_at: "2026-08-29T00:00:00.000Z",
  producer_version: "test",
};

test("completed results require proof for effects and idempotence", () => {
  assert.throws(
    () => completedResult({ data: {}, effect: "changed", provenance }),
    /EFFECT_NOT_PROVEN/u,
  );
  assert.throws(
    () => completedResult({ data: {}, effect: "none", provenance }),
    /NO_EFFECT_NOT_PROVEN/u,
  );
  const result = completedResult({
    data: { value: 1 },
    effect: "none",
    evidence: ["evidence://postcondition"],
    provenance,
  });
  assert.equal(isHarnessResult(result), true);
  assert.equal(result.transport_success, true);
  assert.equal(result.domain_outcome, "completed");
  assert.equal(result.source_revision_id, "src_current");
  assert.equal(result.environment_revision_id, "env_current");
  assert.equal(result.cause, null);
  assert.deepEqual(result.retry_policy, {
    allowed: false,
    responsible_actor: "runtime",
    required_state_change: "not_applicable",
  });
  assert.equal(
    isHarnessResult({ ...result, evidence: [], provenance: {} }),
    false,
  );
});

test("retry ledger suppresses an equivalent attempt until recovery", () => {
  const ledger = new RetryLedger();
  const identity = {
    tool: "run_task",
    normalized_input: { task_id: "test" },
    source_revision_id: "src_one",
    environment_revision_id: "environment-one",
    policy_version: "canonical-result/v3",
  };
  ledger.remember(identity, { condition: "new_source_revision" });
  assert.equal(ledger.canAttempt(identity), false);
  assert.deepEqual(ledger.recovery(identity), {
    condition: "new_source_revision",
  });
  assert.equal(
    ledger.canAttempt({ ...identity, source_revision_id: "src_two" }),
    true,
  );
  ledger.reset();
  assert.equal(ledger.canAttempt(identity), true);
});

test("path dependency groups connect shared resources and explicit consumers", () => {
  const groups = buildPathDependencyGroups([
    operation(0, ["src/a.ts", "src/b.ts"]),
    operation(1, ["src/b.ts"]),
    operation(2, ["src/c.ts"]),
    { ...operation(3, ["src/d.ts"]), consumes_operation_indexes: [2] },
  ]);
  assert.deepEqual(
    groups.map((group) => group.operation_indexes),
    [
      [0, 1],
      [2, 3],
    ],
  );
});

test("edit group aggregation follows the normative table", () => {
  const applied = groupReceipt(
    "a",
    "applied",
    "changed",
    "satisfied",
    "src_one",
    "receipt://a",
  );
  const satisfied = groupReceipt(
    "b",
    "already_satisfied",
    "none",
    "satisfied",
    "src_one",
  );
  const blocked = groupReceipt(
    "c",
    "blocked",
    "none",
    "unsatisfied",
    "src_one",
  );
  const completed = aggregateEditGroupReceipts({
    groups: [applied, satisfied],
    preparation_source_revision: "src_base",
    provenance,
  });
  assert.equal(completed.outcome, "completed");
  assert.equal(completed.effect, "changed");
  const partial = aggregateEditGroupReceipts({
    groups: [applied, blocked],
    preparation_source_revision: "src_base",
    provenance,
  });
  assert.equal(partial.outcome, "blocked");
  assert.equal(partial.effect, "partial");
  assert.equal(partial.satisfaction, "partially_satisfied");
  assert.equal(partial.issue.kind, "invalid_input");
});

test("semantic write rebase refuses weak and ambiguous candidates", () => {
  const base = semanticInput();
  const weak = resolveSemanticCandidate({
    ...base,
    candidates: [candidate("one", 0.9, ["neighbor_and_ordinal_only"])],
  });
  assert.equal(weak.receipt.resolution, "refused");
  assert.equal(weak.reason_code, "WRITE_EVIDENCE_TOO_WEAK");
  const ambiguous = resolveSemanticCandidate({
    ...base,
    candidates: [
      candidate("one", 0.9, ["unique_symbol_fingerprint"]),
      candidate("two", 0.85, ["unique_symbol_fingerprint"]),
    ],
  });
  assert.equal(ambiguous.reason_code, "AMBIGUOUS_TARGET");
  const accepted = resolveSemanticCandidate({
    ...base,
    candidates: [candidate("one", 0.9, ["unique_symbol_fingerprint"])],
  });
  assert.equal(accepted.receipt.policy, semanticRebasePolicyVersion);
  assert.equal(accepted.receipt.resolution, "automatically_rebased");
  assert.equal(accepted.receipt.score, 0.9);
  assert.equal(accepted.receipt.requested_source_revision_id, "src_old");
  assert.equal(accepted.receipt.current_source_revision_id, "src_current");
});

test("evidence planner reuses only fresh evidence and selects a minimum declared cover", () => {
  const planner = new EvidencePlanner();
  const input = plannerInput();
  const planned = planner.plan(input);
  assert.equal(planned.reused_evidence.includes("evidence://old-parse"), true);
  assert.equal(
    planned.selected_checks.some((check) => check.task_id === "test:unit"),
    true,
  );
  assert.equal(
    planned.selected_checks.some((check) => check.task_id === "build"),
    false,
  );
  const stale = planner.plan({
    ...input,
    blob_hashes: { "src/private.ts": "new" },
  });
  assert.equal(stale.reused_evidence.includes("evidence://old-parse"), false);
  const environmentChanged = planner.plan({
    ...input,
    environment_revision_id: "env_changed",
  });
  assert.equal(
    environmentChanged.reused_evidence.includes("evidence://old-parse"),
    false,
  );
  const multiLanguage = planner.plan({
    ...input,
    changed_files: ["src/private.ts", "src/styles.css"],
    changed_symbols: [],
    capability_snapshot: {
      snapshot_id: "capability-multi",
      languages: capabilitySnapshot(["src/private.ts", "src/styles.css"]),
    },
    capability_snapshot_id: "capability-multi",
    task_catalog: [],
    existing_evidence: [
      {
        evidence_ref: "evidence://typescript-current",
        check_id: "native:parse:typescript",
        status: "passed",
        source_revision_id: "src_current",
        environment_revision_id: "env_current",
        paths: ["src/private.ts"],
        policy_version: "evidence-planner/v1",
      },
    ],
  });
  assert.equal(
    multiLanguage.selected_checks.some(
      (check) => check.task_id === "native:parse:css",
    ),
    true,
  );
  const largePlan = planner.plan({
    ...input,
    acceptance_criteria: Array.from({ length: 100 }, (_, index) => ({
      criterion_id: `criterion-${index}`,
      text: `Criterion ${index}`,
      automatable: true,
      required_checks: ["test"],
    })),
  });
  assert.deepEqual(
    largePlan.selected_checks.map(({ task_id }) => task_id),
    ["test:unit"],
  );
});

test("completion remains separate from lifecycle terminal state", () => {
  const plan = new EvidencePlanner().plan(plannerInput());
  const decision = deriveCompletionDecision({
    source_revision_id: "src_current",
    edit_groups: [
      groupReceipt(
        "a",
        "applied",
        "changed",
        "satisfied",
        "src_current",
        "receipt://a",
      ),
    ],
    evidence_plan: plan,
  });
  assert.equal(decision.delivery, "satisfied");
  assert.notEqual(decision.verification, "verified");
  assert.equal(completionLifecycleTerminal(decision), "failed");
  const failed = {
    ...decision,
    failed_obligations: ["test"],
    verification: "failed" as const,
  };
  assert.equal(completionLifecycleTerminal(failed), "failed");
});

test("termination pending stays visible until confirmation", async () => {
  const lifecycle = new ExecutionLifecycle("execution-1", {
    now: () => new Date("2026-08-29T00:00:00.000Z"),
  });
  lifecycle.start();
  lifecycle.running();
  const persisted: string[] = [];
  const published: string[] = [];
  const terminator = new ExecutionTerminator(
    {
      start: async function* () {},
      requestStop: async () => ({
        execution_id: "execution-1",
        status: "pending",
      }),
      dispose: async () => ({ runtime_id: "runtime-1", disposed: true }),
    },
    { persist: async (snapshot) => void persisted.push(snapshot.state) },
    { publish: async (event) => void published.push(event.state) },
  );
  const pending = await terminator.terminate({
    lifecycle,
    state: "cancelled",
    reason: "user",
  });
  assert.equal(pending.state, "cancelling");
  const terminal = await terminator.confirm({
    lifecycle,
    state: "cancelled",
    reason: "user",
  });
  assert.equal(terminal.state, "cancelled");
  assert.deepEqual(persisted, ["cancelling", "cancelled"]);
  assert.deepEqual(published, ["cancelling", "cancelled"]);
});

test("lifecycle business sequencing is independent from state transitions", () => {
  const lifecycle = new ExecutionLifecycle("execution-sequence");
  lifecycle.start();
  lifecycle.running();
  assert.equal(lifecycle.acceptsBusinessEvent(0), true);
  assert.equal(lifecycle.acceptsBusinessEvent(0), false);
  assert.equal(lifecycle.acceptsBusinessEvent(1), true);
  assert.equal(lifecycle.snapshot().sequence, 0);
});

test("execution authority refuses a concurrent execution", () => {
  const authority = new SingleExecutionAuthority();
  authority.begin(new ExecutionLifecycle("execution-one"));
  assert.throws(
    () => authority.begin(new ExecutionLifecycle("execution-two")),
    /ACTIVE_EXECUTION_EXISTS/u,
  );
});

test("state authority invalidates revision-bound projections", () => {
  const authority = new InMemoryStateAuthority({
    source_revision_id: "src_one",
    environment: environmentInput("dependencies-one"),
  });
  const first = authority.current();
  authority.setDependency({ status: "ready", manifest_ref: "cache://one" });
  authority.setPreview({
    readiness: "application_ready",
    revisions: {
      source_revision_id: first.source_revision_id,
      environment_revision_id: first.environment_revision_id,
    },
  });
  const changed = authority.setEnvironment(
    environmentInput("dependencies-two"),
  );
  assert.notEqual(
    changed.environment_revision_id,
    first.environment_revision_id,
  );
  assert.equal(changed.dependency.status, "unknown");
  assert.equal(changed.preview.readiness, "container_ready");
  assert.throws(
    () =>
      authority.setPreview({
        readiness: "application_ready",
        revisions: {
          source_revision_id: first.source_revision_id,
          environment_revision_id: first.environment_revision_id,
        },
      }),
    /PREVIEW_REVISION_MISMATCH/u,
  );
});

test("capability and projection outputs are revision bound", async () => {
  const snapshot = capabilitySnapshot(["src/a.ts", "README.md"]);
  assert.deepEqual(
    snapshot.map((capability) => capability.language_id),
    ["typescript"],
  );
  const engine = new ProjectionEngine();
  const projection = await engine.build({
    kind: "working_set",
    source_revision_id: "src_current",
    epoch: "epoch-1",
    dependencies: { "src/a.ts": "hash-one" },
    build: () => ({ paths: ["src/a.ts"] }),
  });
  engine.invalidate({ "src/a.ts": "hash-two" });
  assert.equal(engine.get(projection.projection_id)?.freshness, "stale");
});

test("release gates combine absolute and statistical requirements", () => {
  const thresholds = initialReleaseThresholds();
  const decision = evaluateReleaseGates(
    {
      schema_version: "1",
      corpus_version: "one",
      tasks: [],
      repository_commits: {},
      model: "model",
      reasoning_effort: "medium",
      parameters: {},
      budgets: { tokens: 1, duration_ms: 1, iterations: 1 },
      versions: { cline: "one", runtime: "one", adapters: {} },
      environment: { platform: "linux", runtime: "local" },
      repetitions: 3,
      seeds: [],
      thresholds,
      raw_metrics_ref: "artifact://metrics",
      calculation_method: "bootstrap",
    },
    {
      false_successes: 1,
      writes_outside_worktree: 0,
      incorrect_automatic_rebases: 0,
      stale_evidence_as_fresh: 0,
      business_events_after_terminal: 0,
      atomic_groups_without_recovery: 0,
      infrastructure_as_code_failure: 0,
    },
    {
      task_count: 100,
      live_repetitions: 3,
      resolution_delta_lower_bound_points: -1,
      solved_task_cost_upper_bound_ratio: 1,
      first_correct_mutation_p95_upper_bound_ratio: 1,
      duplicate_io_ratio: 0,
    },
  );
  assert.equal(decision.passed, false);
  assert.deepEqual(decision.failed_gates, ["false_successes"]);
});

function operation(operationIndex: number, effectivePaths: string[]) {
  return {
    operation_index: operationIndex,
    operation: { operationIndex },
    effective_paths: effectivePaths,
  };
}

function groupReceipt(
  groupId: string,
  outcome: EditGroupReceipt["outcome"],
  effect: EditGroupReceipt["effect"],
  satisfaction: EditGroupReceipt["satisfaction"],
  revision: string,
  receiptRef?: string,
): EditGroupReceipt {
  return {
    group_id: groupId,
    operation_indexes: [0],
    effective_paths: [`${groupId}.ts`],
    outcome,
    effect,
    satisfaction,
    source_revision_before: "src_base",
    source_revision_after: revision,
    ...(outcome === "blocked" ? { issue_code: "CONFLICT" } : {}),
    ...(receiptRef ? { receipt_ref: receiptRef } : {}),
  };
}

function semanticInput() {
  return {
    mode: "write" as const,
    operation: "replace_body" as const,
    requested_source_revision_id: "src_old",
    current_source_revision_id: "src_current",
    original_path: "src/original.ts",
    language_id: "typescript",
    syntax_kind: "function",
    cas_generated: true,
    post_validation_available: true,
    candidates: [],
  };
}

function candidate(
  candidateId: string,
  score: number,
  evidenceClasses: Array<
    "neighbor_and_ordinal_only" | "unique_symbol_fingerprint"
  >,
) {
  return {
    candidate_id: candidateId,
    path: `src/${candidateId}.ts`,
    language_id: "typescript",
    syntax_kind: "function",
    score,
    evidence_classes: evidenceClasses,
  };
}

function plannerInput(): EvidencePlannerInput {
  const [typescript] = capabilitySnapshot(["src/private.ts"]);
  return {
    source_revision_id: "src_current",
    environment_revision_id: "env_current",
    change_receipts: ["receipt://one"],
    changed_files: ["src/private.ts"],
    changed_symbols: [
      {
        path: "src/private.ts",
        symbol: "privateFunction",
        visibility: "private",
        change: "body",
      },
    ],
    semantic_diff: {
      public_api_changed: false,
      data_schema_changed: false,
      dependency_changed: false,
      configuration_changed: false,
      ui_changed: false,
    },
    bounded_relations: { consumers: [], bounded: true },
    task_catalog: [
      {
        task_id: "test:unit",
        kind: "test",
        cwd: ".",
        supports_file_selection: true,
        reliability: "high",
        cost: { duration_ms: 100, compute_units: 1 },
      },
      {
        task_id: "build",
        kind: "build",
        cwd: ".",
        supports_file_selection: false,
        reliability: "high",
        cost: { duration_ms: 10_000, compute_units: 10 },
      },
    ],
    acceptance_criteria: [],
    existing_evidence: [
      {
        evidence_ref: "evidence://old-parse",
        check_id: "native:parse:typescript",
        status: "passed",
        environment_revision_id: "env_current",
        blob_hashes: { "src/private.ts": "same" },
        paths: ["src/private.ts"],
        policy_version: "evidence-planner/v1",
      },
    ],
    capability_snapshot: {
      snapshot_id: "capability-1",
      languages: [typescript!],
    },
    capability_snapshot_id: "capability-1",
    policy_version: "evidence-planner/v1",
    blob_hashes: { "src/private.ts": "same" },
  };
}

function environmentInput(dependencyDigest: string) {
  return {
    dependency_digest: dependencyDigest,
    package_manager: "pnpm",
    resolved_version: "10.33.2",
    platform: "linux",
    architecture: "x64",
    runtime_target: "local",
    build_environment_digest: "build-one",
    dependency_volume_digest: "volume-one",
    execution_profile: "default",
  };
}
