import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import cacache from "cacache";
import test from "node:test";
import { ArtifactStore } from "./artifact-store.js";
import { changeRequestCapsule } from "./change-request-capsule.js";
import { ConversationMemoryStore } from "./conversation-memory.js";
import { semanticWorkspaceTools } from "./cline-tools.js";
import { HarnessCostGovernor } from "./cost-governor.js";
import {
  managedSemanticWorkspaceExecutor,
  type CanonicalSemanticWorkspaceExecutor,
} from "./semantic-executor.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import {
  decodeHandle,
  encodeHandle,
  harnessSuccess,
  type HarnessToolResult,
  type HarnessToolSuccess,
} from "./protocol.js";
import { packagedResourcePath } from "./packaged-resource-path.js";
import {
  harnessReplayComparison,
  harnessReplayMetrics,
  harnessV2ReplayPasses,
  type HarnessReplayEvent,
} from "./harness-v2-benchmark.js";
import { harnessBenchmarkMetrics } from "./harness-benchmark-metrics.js";
import type { HarnessToolObservation } from "./tool-observability.js";
import {
  portfolioV4ObservedTraceSummary,
  replayHarnessTraceJsonl,
} from "./portfolio-v4-trace-replay.js";
import { RunAttemptStore } from "./run-attempt-store.js";
import { ReferenceRegistry } from "./reference-registry.js";
import type {
  TaskExecutionInput,
  TaskExecutionResult,
  TaskExecutor,
} from "./task-executor.js";

const execFileAsync = promisify(execFile);

test("benchmark metrics measure efficiency without enforcing runtime cutoffs", () => {
  const tools = [
    benchmarkObservation("inspect_code", 0),
    benchmarkObservation("inspect_code", 20, { cacheHit: true }),
    benchmarkObservation("edit_code", 50, { effect: "changed" }),
    benchmarkObservation("run_task", 100, {
      cacheHit: true,
      environmentRepair: true,
    }),
    benchmarkObservation("review_change", 120, {
      cause: "invalid_input",
      errorSignature: "error://invalid",
    }),
  ];
  const metrics = harnessBenchmarkMetrics({
    tools,
    model_iterations: [
      { context_tokens: 12_000, duration_ms: 400, iteration: 1 },
      { context_tokens: 8_000, duration_ms: 300, iteration: 2 },
    ],
    submissions: [{ outcome: "blocked" }, { outcome: "accepted" }],
  });
  assert.equal(metrics.time_before_first_mutation_ms, 50);
  assert.equal(metrics.repeated_read_rate, 1 / 3);
  assert.equal(metrics.tool_rejection_rate, 0.2);
  assert.equal(metrics.identical_validations_avoided, 1);
  assert.equal(metrics.environment_repairs, 1);
  assert.equal(metrics.classified_failure_rate, 1);
  assert.equal(metrics.valid_submission_rate, 0.5);
  assert.equal(metrics.maximum_context_tokens, 12_000);
});

test("packaged native resources resolve outside Electron ASAR archives", () => {
  assert.equal(
    packagedResourcePath(
      "/opt/Blame/resources/app.asar/node_modules/parser.so",
    ),
    "/opt/Blame/resources/app.asar.unpacked/node_modules/parser.so",
  );
  assert.equal(
    packagedResourcePath(
      "C:\\Blame\\resources\\app.asar\\node_modules\\parser.dll",
    ),
    "C:\\Blame\\resources\\app.asar.unpacked\\node_modules\\parser.dll",
  );
  assert.equal(packagedResourcePath("/usr/bin/rg"), "/usr/bin/rg");
});

test("Portfolio V4 replay enforces the protocol v2 efficiency invariants", async () => {
  const before = harnessReplayMetrics([
    {
      at_ms: 0,
      context_tokens: 668_748,
      input_tokens: 668_748,
      type: "model_turn",
    },
    {
      at_ms: 10_000,
      blob: "blob-a",
      context_epoch: "epoch-1",
      range: [0, 100],
      returned_bytes: 100,
      type: "read",
    },
    {
      at_ms: 20_000,
      blob: "blob-a",
      context_epoch: "epoch-1",
      range: [0, 100],
      returned_bytes: 100,
      type: "read",
    },
    { at_ms: 1_080_000, tool: "propose", type: "edit" },
    { at_ms: 1_081_000, tool: "review_change", type: "edit" },
    { at_ms: 1_082_000, tool: "commit_proposal", type: "edit" },
    { at_ms: 30_000, fingerprint: "preview-a", type: "preview_recovery" },
    { at_ms: 60_000, fingerprint: "preview-a", type: "preview_recovery" },
    {
      at_ms: 70_000,
      run_ref: "run-a",
      status: "running",
      type: "run_task",
    },
  ]);
  const afterEvents: HarnessReplayEvent[] = [
    {
      at_ms: 0,
      context_tokens: 72_000,
      input_tokens: 72_000,
      type: "model_turn",
    },
    {
      at_ms: 5_000,
      blob: "blob-a",
      context_epoch: "epoch-1",
      range: [0, 100],
      returned_bytes: 80,
      type: "read",
    },
    {
      at_ms: 30_000,
      fact_id: "constraint-mobile",
      preserved: true,
      type: "constraint_check",
    },
    {
      at_ms: 45_000,
      correct: true,
      outcome: "applied",
      tool: "edit_code",
      type: "edit",
    },
    {
      at_ms: 70_000,
      run_ref: "run-a",
      status: "passed",
      type: "run_task",
    },
  ];
  const after = harnessV2ReplayPasses(afterEvents);
  const comparison = harnessReplayComparison(
    [
      {
        at_ms: 0,
        context_tokens: 668_748,
        input_tokens: 668_748,
        type: "model_turn",
      },
      {
        at_ms: 10_000,
        blob: "blob-a",
        context_epoch: "epoch-1",
        range: [0, 200],
        returned_bytes: 200,
        type: "read",
      },
      {
        at_ms: 1_080_000,
        correct: true,
        tool: "commit_proposal",
        type: "edit",
      },
    ],
    afterEvents,
  );
  const traceSource = await readFile(
    join(
      process.cwd(),
      "src/harness/fixtures/portfolio-v4-sanitized.trace.jsonl",
    ),
    "utf8",
  );
  const capturedMetrics = harnessReplayMetrics(
    replayHarnessTraceJsonl(traceSource),
  );
  assert.equal(before.max_context_tokens, 668_748);
  assert.equal(before.identical_reads, 1);
  assert.equal(before.missing_terminal_runs, 1);
  assert.equal(after.passed, true);
  assert.equal(after.metrics.first_edit_ms, 45_000);
  assert.equal(comparison.goals.code_bytes_reduced_by_half, true);
  assert.equal(comparison.goals.context_reduced_by_forty_percent, true);
  assert.equal(comparison.goals.constraints_preserved, true);
  assert.equal(capturedMetrics.accumulated_input_tokens, 70_559);
  assert.equal(capturedMetrics.read_calls, 4);
  assert.equal(portfolioV4ObservedTraceSummary.activities, 600);
  assert.equal(portfolioV4ObservedTraceSummary.inspectCalls, 117);
  assert.equal(portfolioV4ObservedTraceSummary.searchCalls, 124);
});

test("change requests preserve functional memory without raw execution history", async () => {
  await withWorkspace(async (root) => {
    const first = await changeRequestCapsule({
      conversationId: "conversation-memory",
      newRequest: "Keep the mobile layout exactly as approved.",
      storySummary: "The formatter must remain verified.",
      storyTitle: "Formatter",
      workspaceRoot: root,
    });
    const second = await changeRequestCapsule({
      conversationId: "conversation-memory",
      newRequest: "Increase the title size again.",
      storySummary: "The formatter must remain verified.",
      storyTitle: "Formatter",
      workspaceRoot: root,
    });
    const firstCapsule = parseContinuityCapsule(first);
    const secondCapsule = parseContinuityCapsule(second);
    assert.equal(firstCapsule.conversationId, secondCapsule.conversationId);
    assert.notEqual(
      firstCapsule.executionEpochId,
      secondCapsule.executionEpochId,
    );
    assert.equal(secondCapsule.currentRequest, undefined);
    assert.equal(
      secondCapsule.relevantConstraints.some((fact) =>
        fact.value.includes("mobile layout"),
      ),
      true,
    );
    assert.equal(JSON.stringify(secondCapsule).includes("diff"), false);
    assert.equal(second.match(/Increase the title size again\./gu)?.length, 1);
  });
});

test("compact handles remain compatible with legacy object handles", () => {
  const payload = {
    version: 1 as const,
    revision: `src_${"1".repeat(32)}`,
    path: "src/service.ts",
    start: 4,
    end: 20,
    digest: "a".repeat(64),
    kind: "function",
    language: "typescript",
    qualifiedName: "run",
  };
  const compact = encodeHandle("sym", payload);
  const legacy = `sym://${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
  assert.deepEqual(decodeHandle(compact, "sym"), payload);
  assert.deepEqual(decodeHandle(legacy, "sym"), payload);
  assert.ok(compact.length < legacy.length);
});

test("short semantic references persist across workspace reloads and rebase", async () => {
  await withWorkspace(async (root) => {
    const options = { taskContract: { session_id: "persistent-references" } };
    const first = new SemanticWorkspace(root, options);
    const outline = success(
      await first.outlineCode({ target: { path: "src/service.ts" } }),
    );
    const reference = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    )?.symbol_ref;
    assert.match(reference ?? "", /^s_[a-z0-9]{2,10}$/u);
    await writeFile(
      join(root, "src", "service.ts"),
      source.replace("Hello", "Reloaded"),
    );
    const reloaded = new SemanticWorkspace(root, options);
    const inspected = success(
      await reloaded.inspectCode({
        target: { symbol_ref: reference! },
        view: "body",
      }),
    );
    assert.equal(inspected.data.rebased, true);
    const repeated = success(
      await reloaded.outlineCode({ target: { path: "src/service.ts" } }),
    ).data.items.find((item) => item.qualified_name === "formatName");
    assert.ok(repeated);
    assert.match(repeated.symbol_ref, /^s_[a-z0-9]{2,10}$/u);
    assert.ok(repeated.symbol_ref.length <= 12);
  });
});

test("semantic tools expose outlines and rebase stale observations", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
        depth: 3,
      }),
    );
    assert.deepEqual(
      outline.data.items.map((item) => `${item.kind}:${item.qualified_name}`),
      ["class:Greeter", "method:Greeter.greet", "function:formatName"],
    );
    const method = outline.data.items.find(
      (item) => item.qualified_name === "Greeter.greet",
    );
    assert.ok(method);

    const body = success(
      await workspace.inspectCode({
        source_revision_id: revision,
        target: { symbol_ref: method.symbol_ref },
        view: "body",
      }),
    );
    assert.match(body.data.content, /return `Hello/);
    assert.equal(body.data.file_ref.source_revision_id, revision);

    const search = success(
      await workspace.searchCode({
        source_revision_id: revision,
        query: { kind: "text", pattern: "formatName" },
        scope: { paths: ["src"] },
      }),
    );
    assert.equal(search.data.items[0]?.path, "src/service.ts");
    assert.equal(search.data.engine, "ripgrep");
    assert.equal(search.data.items[0]?.matched_text, "formatName");
    assert.match(search.data.items[0]?.context ?? "", /formatName/u);
    assert.match(search.data.items[0]?.match_ref ?? "", /^m_[a-z0-9]{2,10}$/u);
    assert.match(search.data.items[0]?.node_ref ?? "", /^n_[a-z0-9]{2,10}$/u);

    const raw = success(
      await workspace.inspectCode({
        source_revision_id: revision,
        target: { path: "package.json" },
        view: "raw",
        budget: { max_output_tokens: 500 },
      }),
    );
    assert.match(raw.data.content, /"typecheck"/);
    assert.match(raw.data.file_ref.blob_hash, /^[a-f0-9]{64}$/);

    await writeFile(
      join(root, "src", "service.ts"),
      source.replace("Hello", "Hi"),
    );
    const rebased = success(
      await workspace.inspectCode({
        source_revision_id: revision,
        target: { symbol_ref: method.symbol_ref },
        view: "body",
      }),
    );
    assert.equal(rebased.data.rebased, true);
    assert.match(rebased.data.content, /return `Hi/);
  });
});

test("lexical matches stay distinct from AST nodes and relocate uniquely", async () => {
  await withWorkspace(async (root) => {
    const path = join(root, "src", "projects-carousel.tsx");
    const original = [
      'import { ArrowLeft, ArrowRight, ExternalLink, Github } from "lucide-react";',
      "export const Carousel = () => <div />;",
      "",
    ].join("\n");
    await writeFile(path, original);
    const workspace = new SemanticWorkspace(root);
    const search = success(
      await workspace.searchCode({
        query: {
          kind: "text",
          pattern: "import { ArrowLeft, ArrowRight, ExternalLink, Github }",
        },
        scope: { paths: ["src/projects-carousel.tsx"] },
      }),
    );
    const match = search.data.items[0];
    assert.ok(match?.match_ref);
    assert.equal(
      match.matched_text,
      "import { ArrowLeft, ArrowRight, ExternalLink, Github }",
    );
    assert.match(match.context ?? "", /from "lucide-react"/u);
    assert.equal("excerpt" in match, false);
    assert.match(match.node_ref ?? "", /^n_[a-z0-9]{2,10}$/u);
    assert.equal(match.node_text, undefined);
    await writeFile(path, `const shifted = true;\n${original}`);
    const inspected = success(
      await workspace.inspectCode({
        target: { match_ref: match.match_ref },
        view: "raw",
      }),
    );
    assert.equal(inspected.data.rebase_strategy, "unique_text_match");
    assert.equal(inspected.data.content, match.matched_text);
    const edited = success(
      await workspace.editCode({
        edits: [
          {
            operation: "replace",
            target: { match_ref: match.match_ref },
            content: "import { ArrowLeft, ArrowRight, ExternalLink }",
          },
        ],
      }),
    );
    assert.equal(edited.data.outcome, "applied");
    const content = await readFile(path, "utf8");
    assert.match(
      content,
      /import \{ ArrowLeft, ArrowRight, ExternalLink \} from "lucide-react";/u,
    );
    assert.doesNotMatch(content, /; from "lucide-react"/u);
  });
});

test("security reads redact credential values while preserving source handles", async () => {
  await withWorkspace(async (root) => {
    const secret = `ghp_${"A".repeat(24)}`;
    await writeFile(
      join(root, "src", "credentials.ts"),
      `export const token = "${secret}";\n`,
    );
    await execFileAsync("git", ["add", "src/credentials.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "add credential fixture"], {
      cwd: root,
    });
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const inspectTool = semanticWorkspaceTools(root, {
      redactSensitiveContent: true,
    }).find((tool) => tool.name === "inspect_code");
    assert.ok(inspectTool);
    const raw = await inspectTool.execute(
      {
        source_revision_id: revision,
        target: { path: "src/credentials.ts" },
        view: "raw",
      },
      { agentId: "test", iteration: 1 },
    );
    const serialized = JSON.stringify(raw);
    assert.match(serialized, /REDACTED_SECRET/);
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.match(serialized, /[a-f0-9]{64}/);
  });
});

test("apply_change proposes, reviews, and atomically commits an exact node edit", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);

    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "replace-format-name",
        operations: [
          {
            kind: "replace_node",
            target: target.symbol_ref,
            replacement:
              "function formatName(value: string) {\n  return value.trim().toUpperCase();\n}",
          },
        ],
        checks: ["parse"],
      }),
    );
    assert.match(proposed.data.proposal_ref, /^change-proposal:\/\//);
    const proposalPath = storedProposalPath(root, proposed.data.proposal_ref);
    const persisted = JSON.parse(await readFile(proposalPath, "utf8")) as {
      changes: Array<Record<string, unknown>>;
      content_hash: string;
    };
    assert.match(persisted.content_hash, /^[a-f0-9]{64}$/);
    assert.equal("old_content" in persisted.changes[0]!, false);
    assert.equal("new_content" in persisted.changes[0]!, false);
    assert.match(
      String(
        (persisted.changes[0]?.old_artifact as { ref?: string } | undefined)
          ?.ref,
      ),
      /^artifact:\/\//,
    );
    assert.equal(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      source,
    );

    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposed.data.proposal_ref,
      }),
    );
    assert.match(review.data.diff, /toUpperCase/);
    assert.deepEqual(review.data.checks_not_run, [
      "lint",
      "typecheck",
      "tests",
    ]);
    assert.equal(review.data.stale, false);
    assert.deepEqual(review.data.symbol_changes[0]?.modified, [
      "function:formatName",
    ]);

    const idempotencyConflict = await workspace.applyChange({
      action: "propose",
      base_source_revision_id: revision,
      idempotency_key: "replace-format-name",
      operations: [
        { kind: "create_file", path: "src/other.ts", content: "export {};\n" },
      ],
    });
    assert.equal(idempotencyConflict.status, "error");
    if (idempotencyConflict.status === "error")
      assert.equal(idempotencyConflict.error.code, "PRECONDITION_FAILED");

    const committed = success(
      await workspace.applyChange({
        action: "commit_proposal",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "commit-format-name",
      }),
    );
    assert.notEqual(
      committed.data.source_revision.source_revision_id,
      revision,
    );
    assert.match(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      /toUpperCase/,
    );
    if (process.platform !== "win32")
      assert.equal(
        (await stat(join(root, "src", "service.ts"))).mode & 0o777,
        0o755,
      );

    const retried = success(
      await workspace.applyChange({
        action: "commit_proposal",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "commit-format-name",
      }),
    );
    assert.equal(
      retried.data.source_revision.source_revision_id,
      committed.data.source_revision.source_revision_id,
    );
  });
});

test("tool schemas reject contradictory and unknown input before execution", async () => {
  await withWorkspace(async (root) => {
    const tools = semanticWorkspaceTools(root);
    const inspect = tools.find((tool) => tool.name === "inspect_code");
    assert.ok(inspect);
    const invalid = await inspect.execute(
      {
        source_revision_id: "src_00000000000000000000000000000000",
        target: { path: "src/service.ts" },
        view: "body",
        unexpected: true,
      },
      { agentId: "test", iteration: 1 },
    );
    assert.equal((invalid as { isError?: boolean }).isError, false);
    assert.equal(
      (invalid as { output?: { outcome?: string } }).output?.outcome,
      "failed",
    );
    assert.equal(
      (invalid as { output?: { fatal?: boolean } }).output?.fatal,
      false,
    );
    assert.match(JSON.stringify(invalid), /unrecognized|raw view/i);
  });
});

test("every harness tool call records revision-bound observability", async () => {
  await withWorkspace(async (root) => {
    const inspect = semanticWorkspaceTools(root, {
      protocolVersion: "3",
    }).find((tool) => tool.name === "inspect_code");
    assert.ok(inspect);
    await inspect.execute(
      {
        target: { path: "src/service.ts" },
        view: "unsupported-view",
      },
      { agentId: "test", iteration: 1, runId: "observability-run" },
    );
    const log = await readFile(
      join(root, ".blame", "harness", "observability", "tool-calls.jsonl"),
      "utf8",
    );
    const observation = JSON.parse(log.trim()) as Record<string, unknown>;
    assert.equal(observation.tool, "inspect_code");
    assert.equal(observation.target, "src/service.ts");
    assert.equal(observation.result_cause, "invalid_input");
    assert.match(String(observation.source_revision_id), /^src_/u);
    assert.match(String(observation.environment_revision_id), /^env_/u);
    assert.match(
      String(observation.normalized_input_digest),
      /^[a-f0-9]{64}$/u,
    );
    assert.equal(typeof observation.duration, "number");
  });
});

test("persisted proposals are content-addressed and tampering is rejected", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "tamper-proposal",
        operations: [
          { kind: "create_file", path: "src/safe.ts", content: "export {};\n" },
        ],
      }),
    );
    const path = storedProposalPath(root, proposed.data.proposal_ref);
    const stored = JSON.parse(await readFile(path, "utf8")) as {
      changes: Array<{ path: string }>;
    };
    stored.changes[0]!.path = ".env";
    await writeFile(path, JSON.stringify(stored));

    const committed = await workspace.applyChange({
      action: "commit_proposal",
      proposal_ref: proposed.data.proposal_ref,
      expected_base_source_revision_id: revision,
      idempotency_key: "tamper-commit",
    });
    assert.equal(committed.status, "error");
    await assert.rejects(readFile(join(root, "src", "safe.ts")));
    await assert.rejects(readFile(join(root, ".env")));
  });
});

test("apply_change commits bounded worktree edits in one idempotent call", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const input = {
      action: "apply" as const,
      base_source_revision_id: state.data.source_revision.source_revision_id,
      idempotency_key: "direct-apply-new-module",
      operations: [
        {
          kind: "create_file" as const,
          path: "src/direct.ts",
          content: "export const direct = true;\n",
        },
      ],
      checks: ["parse" as const],
    };
    const applied = success(await workspace.applyChange(input));
    assert.match(applied.data.proposal.proposal_ref, /^change-proposal:\/\//);
    assert.deepEqual(applied.data.receipt.changed_files, ["src/direct.ts"]);
    assert.equal(
      await readFile(join(root, "src", "direct.ts"), "utf8"),
      "export const direct = true;\n",
    );
    const retried = success(await workspace.applyChange(input));
    assert.equal(
      retried.data.receipt.change_set_ref,
      applied.data.receipt.change_set_ref,
    );
  });
});

test("edit_code applies a semantic edit without caller revisions or preconditions", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "edit-session" },
    });
    const memory = new ConversationMemoryStore(root, "edit-session");
    const initialEpoch = await memory.currentEpochId();
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    await writeFile(join(root, "README.md"), "unrelated change\n");
    const input = {
      edits: [
        {
          operation: "replace" as const,
          target: { symbol_ref: target.symbol_ref },
          content:
            "function formatName(value: string) { return value.trim().toUpperCase(); }",
        },
      ],
      validation: { parse: true },
    };
    const applied = success(
      await workspace.editCode(input, {
        sessionId: "edit-session",
        toolCallId: "edit-call-1",
      }),
    );
    assert.equal(applied.data.status, "applied");
    if (applied.data.status !== "applied") return;
    assert.equal(applied.data.resolution, "exact");
    assert.equal(applied.data.validation.parse, "passed");
    const appliedEpoch = await memory.currentEpochId();
    assert.equal(appliedEpoch, initialEpoch);
    assert.deepEqual(
      applied.data.changed_files.map(({ path }) => path),
      ["src/service.ts"],
    );
    assert.match(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      /toUpperCase/,
    );
    const repeated = success(
      await workspace.editCode(input, {
        sessionId: "edit-session",
        toolCallId: "edit-call-1",
      }),
    );
    assert.equal(repeated.data.status, "applied");
    if (repeated.data.status === "applied")
      assert.equal(repeated.data.receipt_ref, applied.data.receipt_ref);
    assert.equal(await memory.currentEpochId(), appliedEpoch);
  });
});

test("edit_code applies a named symbol replacement and import atomically", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const applied = success(
      await workspace.editCode({
        atomicity: "all",
        operations: [
          {
            operation: "ensure_import",
            path: "src/service.ts",
            from: "./format-helper",
            names: ["decorateName"],
          },
          {
            operation: "replace_symbol",
            path: "src/service.ts",
            symbol: "formatName",
            replacement:
              "export function formatName(value: string) { return decorateName(value.trim()); }",
          },
        ],
        validation: { parse: true },
      }),
    );
    assert.equal(applied.data.status, "applied");
    if (applied.data.status !== "applied") return;
    assert.equal(applied.data.groups?.length, 1);
    assert.equal(applied.data.committed_revisions?.length, 1);
    const content = await readFile(join(root, "src", "service.ts"), "utf8");
    assert.match(
      content,
      /import \{ decorateName \} from "\.\/format-helper";/,
    );
    assert.match(content, /return decorateName\(value\.trim\(\)\)/);
  });
});

test("edit_code automatically relocates a moved symbol", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: state.data.source_revision.source_revision_id,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    await writeFile(
      join(root, "src", "service.ts"),
      `const moved = true;\n${source}`,
    );
    const applied = success(
      await workspace.editCode(
        {
          edits: [
            {
              operation: "replace",
              target: { symbol_ref: target.symbol_ref },
              content:
                "function formatName(value: string) { return value.toLowerCase(); }",
            },
          ],
        },
        { toolCallId: "relocate-symbol" },
      ),
    );
    assert.equal(applied.data.status, "applied");
    if (applied.data.status === "applied")
      assert.equal(applied.data.resolution, "automatically_rebased");
    assert.match(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      /toLowerCase/,
    );
  });
});

test("semantic insertion uses the complete exported declaration boundary", async () => {
  await withWorkspace(async (root) => {
    const path = join(root, "src", "page.tsx");
    await writeFile(
      path,
      "export default async function Home() {\n  return <main />;\n}\n",
    );
    const workspace = new SemanticWorkspace(root);
    const outline = success(
      await workspace.outlineCode({ target: { path: "src/page.tsx" } }),
    );
    const home = outline.data.items.find(
      (item) => item.qualified_name === "Home",
    );
    assert.ok(home);
    const result = success(
      await workspace.editCode({
        edits: [
          {
            operation: "insert_before",
            target: { symbol_ref: home.symbol_ref },
            content: 'import "./projects.css";\n\n',
          },
        ],
      }),
    );
    assert.equal(result.data.outcome, "applied");
    assert.equal(
      await readFile(path, "utf8"),
      'import "./projects.css";\n\nexport default async function Home() {\n  return <main />;\n}\n',
    );
  });
});

test("semantic insertion uses the complete CSS import boundary", async () => {
  await withWorkspace(async (root) => {
    const path = join(root, "src", "globals.css");
    await writeFile(path, '@import "tailwindcss";\n\nbody { color: black; }\n');
    const workspace = new SemanticWorkspace(root);
    const search = success(
      await workspace.searchCode({
        query: { kind: "text", pattern: "tailwindcss" },
        scope: { paths: ["src/globals.css"] },
      }),
    );
    const nodeRef = search.data.items[0]?.node_ref;
    assert.ok(nodeRef);
    const result = success(
      await workspace.editCode({
        edits: [
          {
            operation: "insert_after",
            target: { node_ref: nodeRef },
            content: '\n@import "./theme.css";',
          },
        ],
      }),
    );
    assert.equal(result.data.outcome, "applied");
    assert.equal(
      await readFile(path, "utf8"),
      '@import "tailwindcss";\n@import "./theme.css";\n\nbody { color: black; }\n',
    );
  });
});

test("edit_code replaces only a symbol body after a cross-file move", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const outline = success(
      await workspace.outlineCode({ target: { path: "src/service.ts" } }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    await writeFile(
      join(root, "src", "service.ts"),
      source.replace(/\nexport function formatName[\s\S]*$/u, "\n"),
    );
    await writeFile(
      join(root, "src", "format-name.ts"),
      "export function formatName(value: string) {\n  return value.trim();\n}\n",
    );
    const applied = success(
      await workspace.editCode({
        edits: [
          {
            operation: "replace_body",
            target: { symbol_ref: target.symbol_ref },
            content: "{\n  return value.toUpperCase();\n}",
          },
        ],
      }),
    );
    assert.equal(applied.data.status, "applied");
    if (applied.data.status === "applied") {
      assert.equal(applied.data.resolution, "automatically_rebased");
      assert.match(applied.data.semantic_rebase_strategy ?? "", /cross_file/);
    }
    const moved = await readFile(join(root, "src", "format-name.ts"), "utf8");
    assert.match(moved, /function formatName\(value: string\)/);
    assert.match(moved, /return value\.toUpperCase/);
  });
});

test("edit_code returns candidates without writing an ambiguous target", async () => {
  await withWorkspace(async (root) => {
    const duplicateSource = [
      "function duplicate(value: string) { return value; }",
      "function duplicate(value: number) { return value; }",
      "",
    ].join("\n");
    await writeFile(join(root, "src", "duplicate.ts"), duplicateSource);
    const workspace = new SemanticWorkspace(root);
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/duplicate.ts" },
      }),
    );
    const target = outline.data.items[0];
    assert.ok(target);
    const expanded = await new ReferenceRegistry(
      root,
      "unscoped-session",
    ).expand({ symbol_ref: target.symbol_ref });
    const payload = decodeHandle(expanded.symbol_ref, "sym");
    assert.ok(payload);
    const ambiguousRef = encodeHandle("sym", {
      ...payload,
      signatureDigest: undefined,
    });
    await writeFile(join(root, "src", "duplicate.ts"), `\n${duplicateSource}`);
    const result = success(
      await workspace.editCode(
        {
          edits: [
            {
              operation: "delete",
              target: { symbol_ref: ambiguousRef },
            },
          ],
        },
        { toolCallId: "ambiguous-symbol" },
      ),
    );
    assert.equal(result.data.status, "conflict");
    if (result.data.status === "conflict") {
      assert.equal(result.data.candidates.length, 2);
      assert.equal(
        result.data.candidates.every(
          (candidate) => "excerpt" in candidate && candidate.excerpt.length > 0,
        ),
        true,
      );
      assert.equal(
        result.data.candidates.every((candidate) => "score" in candidate),
        true,
      );
    }
    assert.equal(
      await readFile(join(root, "src", "duplicate.ts"), "utf8"),
      `\n${duplicateSource}`,
    );
  });
});

test("edit_code applies a multifile batch and enforces protected paths", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const applied = success(
      await workspace.editCode(
        {
          edits: [
            {
              operation: "create_file",
              path: "src/first-v2.ts",
              content: "export const first = true;\n",
            },
            {
              operation: "create_file",
              path: "src/second-v2.ts",
              content: "export const second = true;\n",
            },
          ],
        },
        { toolCallId: "multifile-v2" },
      ),
    );
    assert.equal(applied.data.status, "applied");
    if (applied.data.status === "applied")
      assert.deepEqual(
        applied.data.changed_files.map(({ path }) => path),
        ["src/first-v2.ts", "src/second-v2.ts"],
      );
    const denied = success(
      await workspace.editCode(
        {
          edits: [
            {
              operation: "create_file",
              path: ".blame/forbidden.json",
              content: "{}",
            },
          ],
        },
        { toolCallId: "protected-v2" },
      ),
    );
    assert.equal(denied.data.status, "denied");
    await assert.rejects(readFile(join(root, ".blame", "forbidden.json")));
  });
});

test("edit_code treats CSS selectors as symbols and updates declarations", async () => {
  await withWorkspace(async (root) => {
    await writeFile(
      join(root, "src", "styles.css"),
      ".card {\n  color: red;\n  padding: 4px;\n}\n@media (max-width: 600px) {\n  .card { color: blue; }\n}\n",
    );
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: state.data.source_revision.source_revision_id,
        target: { path: "src/styles.css" },
        depth: 4,
      }),
    );
    const rule = outline.data.items.find(
      (item) => item.qualified_name === ".card",
    );
    assert.ok(rule);
    assert.equal(rule.kind, "css_rule");
    assert.equal(
      outline.data.items.some(
        (item) => item.qualified_name === "@media(max-width: 600px)::.card",
      ),
      true,
    );
    const applied = success(
      await workspace.editCode(
        {
          edits: [
            {
              operation: "set_css_declarations",
              target: { symbol_ref: rule.symbol_ref },
              declarations: { color: "green", padding: null, margin: "8px" },
            },
          ],
        },
        { toolCallId: "css-declarations" },
      ),
    );
    assert.equal(applied.data.status, "applied");
    const css = await readFile(join(root, "src", "styles.css"), "utf8");
    assert.match(css, /color: green/);
    assert.match(css, /margin: 8px/);
    assert.doesNotMatch(css, /padding:/);
  });
});

test("CSS AST edits preserve comments, fallbacks, order, and complex values", async () => {
  await withWorkspace(async (root) => {
    const cssSource = [
      ".card {",
      "  /* retained */",
      "  display: -webkit-box;",
      "  display: grid;",
      '  background: url("data:image/svg+xml;a;b");',
      "  color: red;",
      "}",
      "",
    ].join("\n");
    await writeFile(join(root, "src", "complex.css"), cssSource);
    const workspace = new SemanticWorkspace(root);
    const rule = success(
      await workspace.outlineCode({ target: { path: "src/complex.css" } }),
    ).data.items.find((item) => item.qualified_name === ".card");
    assert.ok(rule);
    const set = success(
      await workspace.editCode({
        edits: [
          {
            operation: "set_css_declaration",
            target: { symbol_ref: rule.symbol_ref },
            property: "display",
            value: "flex",
          },
        ],
      }),
    );
    assert.equal(set.data.status, "applied");
    const inserted = success(
      await workspace.editCode({
        edits: [
          {
            operation: "insert_css_declaration",
            target: { symbol_ref: rule.symbol_ref },
            property: "--surface",
            value: 'url("data:text/plain;a;b")',
            after_property: "background",
          },
        ],
      }),
    );
    assert.equal(inserted.data.status, "applied");
    const css = await readFile(join(root, "src", "complex.css"), "utf8");
    assert.match(css, /\/\* retained \*\//);
    assert.match(css, /display: -webkit-box;\n {2}display: flex;/);
    assert.match(css, /background: url\("data:image\/svg\+xml;a;b"\);/);
    assert.match(css, /--surface: url\("data:text\/plain;a;b"\);/);
    assert.ok(css.indexOf("background:") < css.indexOf("--surface:"));
  });
});

test("patch_file recovers shifted hunks and isolates ambiguous anchors", async () => {
  await withWorkspace(async (root) => {
    const path = join(root, "src", "settings.txt");
    await writeFile(path, "zero\nalpha\nbeta\ngamma\n");
    const workspace = new SemanticWorkspace(root);
    const shifted = success(
      await workspace.editCode({
        edits: [
          {
            operation: "patch_file",
            path: "src/settings.txt",
            patch:
              "--- a/src/settings.txt\n+++ b/src/settings.txt\n@@ -2,1 +2,1 @@\n-beta\n+BETA\n",
          },
        ],
      }),
    );
    assert.equal(shifted.data.status, "applied");
    assert.match(await readFile(path, "utf8"), /BETA/);
    await writeFile(path, "same\nmiddle\nsame\n");
    const ambiguous = success(
      await workspace.editCode({
        edits: [
          {
            operation: "patch_file",
            path: "src/settings.txt",
            patch:
              "--- a/src/settings.txt\n+++ b/src/settings.txt\n@@ -9,1 +9,1 @@\n-same\n+changed\n",
          },
          {
            operation: "create_file",
            path: "src/partial.txt",
            content: "must not exist\n",
          },
        ],
      }),
    );
    assert.equal(ambiguous.data.status, "conflict");
    if (ambiguous.data.status !== "conflict") return;
    assert.equal(ambiguous.data.failed_operations?.[0]?.status, "conflict");
    assert.match(
      ambiguous.data.failed_operations?.[0]?.reason ?? "",
      /more than one/i,
    );
    assert.equal(await readFile(path, "utf8"), "same\nmiddle\nsame\n");
    await assert.rejects(readFile(join(root, "src", "partial.txt"), "utf8"));
  });
});

test("edit_code rolls back the full batch after a parse validation failure", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: state.data.source_revision.source_revision_id,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    const result = success(
      await workspace.editCode(
        {
          edits: [
            {
              operation: "replace",
              target: { symbol_ref: target.symbol_ref },
              content: "function formatName( {",
            },
            {
              operation: "create_file",
              path: "src/should-not-exist.ts",
              content: "export const created = true;\n",
            },
          ],
        },
        { toolCallId: "invalid-batch" },
      ),
    );
    assert.equal(result.data.status, "validation_failed");
    if (result.data.status !== "validation_failed") return;
    assert.deepEqual(
      result.data.failed_operations?.map(
        ({ operation_index }) => operation_index,
      ),
      [0],
    );
    assert.equal(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      source,
    );
    await assert.rejects(
      readFile(join(root, "src", "should-not-exist.ts"), "utf8"),
    );
  });
});

test("inspect_code rehydrates exact content after a context epoch changes", async () => {
  await withWorkspace(async (root) => {
    const largeSource = Array.from(
      { length: 80 },
      (_, index) => `export const value${index} = "${index}";`,
    ).join("\n");
    await writeFile(join(root, "src", "large.ts"), largeSource);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "add large source"]);
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "read-session" },
    });
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    const first = success(
      await workspace.inspectCode(
        {
          source_revision_id: revision,
          target: { path: "src/service.ts" },
          view: "raw",
          range_utf8_bytes: [0, 40],
        },
        undefined,
        { contextEpoch: "epoch-1" },
      ),
    );
    assert.equal(first.data.status, "content");
    const repeated = success(
      await workspace.inspectCode(
        {
          source_revision_id: revision,
          target: { path: "src/service.ts" },
          view: "raw",
          range_utf8_bytes: [0, 40],
        },
        undefined,
        { contextEpoch: "epoch-1" },
      ),
    );
    assert.equal(repeated.data.status, "already_available");
    const overlap = success(
      await workspace.inspectCode(
        {
          source_revision_id: revision,
          target: { path: "src/service.ts" },
          view: "raw",
          range_utf8_bytes: [20, 60],
        },
        undefined,
        { contextEpoch: "epoch-1" },
      ),
    );
    assert.equal(overlap.data.status, "partial");
    assert.deepEqual(overlap.data.segments[0]?.range_utf8_bytes, [40, 60]);
    assert.equal(overlap.data.new_bytes, 20);
    assert.equal(overlap.data.overlap_rate, 0.5);
    const limitedInput = {
      source_revision_id: revision,
      target: { path: "src/large.ts" },
      view: "raw" as const,
      range_utf8_bytes: [0, Buffer.byteLength(largeSource)] as [number, number],
      budget: { max_output_tokens: 100 },
    };
    const limited = success(
      await workspace.inspectCode(limitedInput, undefined, {
        contextEpoch: "epoch-1",
      }),
    );
    const limitedContinuation = success(
      await workspace.inspectCode(limitedInput, undefined, {
        contextEpoch: "epoch-1",
      }),
    );
    assert.equal(limited.data.status, "content");
    assert.ok(limited.data.omitted_bytes > 0);
    assert.equal(limitedContinuation.data.status, "partial");
    assert.ok(limitedContinuation.data.new_bytes > 0);
    const compacted = success(
      await workspace.inspectCode(
        {
          source_revision_id: revision,
          target: { path: "src/service.ts" },
          view: "raw",
          range_utf8_bytes: [0, 40],
        },
        undefined,
        { contextEpoch: "epoch-2" },
      ),
    );
    assert.equal(compacted.data.status, "content");
    assert.equal(compacted.data.new_bytes, 40);
  });
});

test("working set isolates semantic and raw view receipts", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root, {
      taskContract: { session_id: "cross-view" },
    });
    const symbol = success(
      await workspace.outlineCode({ target: { path: "src/service.ts" } }),
    ).data.items.find((item) => item.qualified_name === "formatName");
    assert.ok(symbol);
    const semantic = success(
      await workspace.inspectCode(
        { target: { symbol_ref: symbol.symbol_ref }, view: "body" },
        undefined,
        { contextEpoch: "cross-view:epoch:1" },
      ),
    );
    const raw = success(
      await workspace.inspectCode(
        {
          target: { path: "src/service.ts" },
          view: "raw",
          range_utf8_bytes: semantic.data.range_utf8_bytes,
        },
        undefined,
        { contextEpoch: "cross-view:epoch:1" },
      ),
    );
    assert.equal(raw.data.status, "content");
    assert.equal(raw.data.segments.length, 1);
  });
});

test("conversation constraints and recall survive multiple execution epochs", async () => {
  await withWorkspace(async (root) => {
    const memory = new ConversationMemoryStore(root, "durable-conversation");
    const first = await memory.beginRequest({
      currentRequest: "Keep the mobile title blue.",
      userGoal: "Improve the portfolio.",
    });
    await memory.recordAssistant("The mobile title is now blue.");
    await memory.recordChange({
      receiptId: "changeset://blue-title",
      files: ["src/styles.css"],
      symbols: [".title"],
      summary: "Changed the mobile title from black to blue.",
      validation: "passed",
    });
    const latest = await memory.beginRequest({
      currentRequest: "Return to the previous title color.",
      userGoal: "Improve the portfolio.",
    });
    assert.notEqual(
      first.capsule.executionEpochId,
      latest.capsule.executionEpochId,
    );
    assert.equal(
      latest.capsule.relevantConstraints.some((fact) =>
        fact.value.includes("mobile title blue"),
      ),
      true,
    );
    const recalled = await memory.recall({ topic: "title color" });
    assert.equal(recalled.changes[0]?.id, "changeset://blue-title");
    assert.equal(
      recalled.dialogue.some((turn) => turn.content.includes("blue")),
      true,
    );
  });
});

test("apply_change rejects metadata and secret paths", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    for (const path of [".env", ".npmrc", ".blame/injected.json"]) {
      const result = await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: `protect-${path}`,
        operations: [{ kind: "create_file", path, content: "secret" }],
      });
      assert.equal(result.status, "error");
      if (result.status === "error")
        assert.equal(result.error.code, "POLICY_DENIED");
    }
  });
});

test("separate workspace instances serialize concurrent commits", async () => {
  await withWorkspace(async (root) => {
    const first = new SemanticWorkspace(root);
    const second = new SemanticWorkspace(root);
    const state = success(await first.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const proposals = await Promise.all([
      first.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "concurrent-first",
        operations: [
          {
            kind: "create_file",
            path: "src/first.ts",
            content: "export {};\n",
          },
        ],
      }),
      second.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "concurrent-second",
        operations: [
          {
            kind: "create_file",
            path: "src/second.ts",
            content: "export {};\n",
          },
        ],
      }),
    ]);
    const [firstProposal, secondProposal] = proposals.map(success);
    const results = await Promise.all([
      first.applyChange({
        action: "commit_proposal",
        proposal_ref: firstProposal.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "concurrent-first-commit",
      }),
      second.applyChange({
        action: "commit_proposal",
        proposal_ref: secondProposal.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "concurrent-second-commit",
      }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [
      "error",
      "success",
    ]);
    assert.equal(
      (await exists(join(root, "src", "first.ts"))) +
        (await exists(join(root, "src", "second.ts"))),
      1,
    );
  });
});

test("commit recovery rolls back an interrupted write before retrying", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "recovery-proposal",
        operations: [
          {
            kind: "create_file",
            path: "src/recovered.ts",
            content: "export const recovered = true;\n",
          },
        ],
      }),
    );
    const stored = JSON.parse(
      await readFile(
        storedProposalPath(root, proposed.data.proposal_ref),
        "utf8",
      ),
    ) as {
      changes: Array<{
        path: string;
        new_artifact: { ref: string };
      }>;
    };
    const artifact = new ArtifactStore(root);
    const partiallyWritten = await artifact.get(
      stored.changes[0]!.new_artifact.ref,
    );
    await writeFile(join(root, "src", "recovered.ts"), partiallyWritten);
    const journalDirectory = join(root, ".blame", "harness", "journals");
    await mkdir(journalDirectory, { recursive: true });
    await writeFile(
      join(journalDirectory, "active.json"),
      JSON.stringify({
        schema_version: "1.0",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "recovery-commit",
        changed_files: ["src/recovered.ts"],
        created_at: new Date().toISOString(),
      }),
    );

    const committed = success(
      await workspace.applyChange({
        action: "commit_proposal",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "recovery-commit",
      }),
    );
    assert.deepEqual(committed.data.changed_files, ["src/recovered.ts"]);
    assert.equal(
      await readFile(join(root, "src", "recovered.ts"), "utf8"),
      "export const recovered = true;\n",
    );
    await assert.rejects(readFile(join(journalDirectory, "active.json")));
  });
});

test("review_change emits multi-hunk diffs and binary summaries", async () => {
  await withWorkspace(async (root) => {
    const lines = Array.from({ length: 30 }, (_, index) => `line-${index}\n`);
    const text = lines.join("");
    await writeFile(join(root, "src", "many.ts"), text);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "many lines"]);
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const expectedHash = await fileDigest(join(root, "src", "many.ts"));
    const first = Buffer.byteLength(lines.slice(0, 2).join(""));
    const second = Buffer.byteLength(lines.slice(0, 25).join(""));
    const textProposal = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "multi-hunk-proposal",
        operations: [
          {
            kind: "text_replace",
            path: "src/many.ts",
            expected_blob_hash: expectedHash,
            range_utf8_bytes: [first, first + Buffer.byteLength("line-2")],
            expected_old_text: "line-2",
            replacement: "changed-2",
          },
          {
            kind: "text_replace",
            path: "src/many.ts",
            expected_blob_hash: expectedHash,
            range_utf8_bytes: [second, second + Buffer.byteLength("line-25")],
            expected_old_text: "line-25",
            replacement: "changed-25",
          },
        ],
      }),
    );
    const review = success(
      await workspace.reviewChange({
        proposal_ref: textProposal.data.proposal_ref,
      }),
    );
    assert.ok((review.data.diff.match(/@@/g) ?? []).length >= 4);

    const binaryProposal = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "binary-proposal",
        operations: [
          { kind: "create_file", path: "src/blob.bin", content: "\0binary" },
        ],
      }),
    );
    const binaryReview = success(
      await workspace.reviewChange({
        proposal_ref: binaryProposal.data.proposal_ref,
      }),
    );
    assert.match(binaryReview.data.diff, /Binary files/);
  });
});

test("review_change reviews the current revision without an opaque reference", async () => {
  await withWorkspace(async (root) => {
    await writeFile(
      join(root, "src", "service.ts"),
      source.replace("value.trim()", "value.trim().toUpperCase()"),
    );
    const workspace = new SemanticWorkspace(root);
    const review = success(await workspace.reviewChange({}));
    assert.match(review.data.diff, /toUpperCase/);
    assert.equal(review.data.stale, false);
    assert.match(review.data.proposal_ref, /^change-proposal:\/\//u);
    const aliasReview = success(
      await workspace.reviewChange({ proposal_ref: "revision:current" }),
    );
    assert.equal(aliasReview.data.proposal_ref, review.data.proposal_ref);
  });
});

test("review_change rejects a placeholder proposal reference", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const result = await workspace.reviewChange({
      proposal_ref: `change-proposal://${"0".repeat(64)}`,
    });
    assert.equal(result.status, "error");
    if (result.status === "error")
      assert.equal(result.error.code, "INVALID_INPUT");
  });
});

test("large diffs expose truncation and an exact artifact continuation", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const content = Array.from(
      { length: 1_500 },
      (_, index) => `export const value${index} = ${index};\n`,
    ).join("");
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: state.data.source_revision.source_revision_id,
        idempotency_key: "large-diff-proposal",
        operations: [
          { kind: "create_file", path: "src/generated.ts", content },
        ],
      }),
    );
    assert.equal(proposed.coverage.truncated, true);
    assert.equal(proposed.data.diff_truncated, true);
    assert.ok((proposed.data.diff_bytes ?? 0) > 12_000);

    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposed.data.proposal_ref,
        budget: { max_output_tokens: 200 },
      }),
    );
    assert.equal(review.coverage.truncated, true);
    const continuation = Number(review.coverage.continuation);
    assert.ok(Number.isInteger(continuation) && continuation > 0);
    const remainder = success(
      await workspace.inspectArtifact({
        artifact_ref: review.data.diff_artifact_ref,
        view: "text",
        offset_bytes: continuation,
        budget: { max_output_tokens: 200 },
      }),
    );
    assert.ok(
      String((remainder.data as unknown as { content: unknown }).content)
        .length > 0,
    );
  });
});

test("artifact reads verify cached content integrity", async () => {
  await withWorkspace(async (root) => {
    const artifacts = new ArtifactStore(root);
    const ref = await artifacts.put("trusted", "text/plain");
    const cache = join(root, ".blame", "harness", "artifacts");
    const info = await cacache.get.info(cache, ref.ref);
    assert.ok(info?.path);
    await writeFile(info.path, "tampered");
    await assert.rejects(artifacts.get(ref.ref));
  });
});

test("run_task isolates writes, captures effects, logs evidence, and is idempotent", async () => {
  await withWorkspace(async (root) => {
    const executor = new RecordingTaskExecutor();
    const workspace = new SemanticWorkspace(root, { taskExecutor: executor });
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    assert.equal(state.data.capabilities.execution.run_task.available, true);

    const input = {
      source_revision_id: revision,
      task: { task_id: "test" },
      limits: { timeout_ms: 10_000 },
    };
    const executed = success(
      await workspace.runTask(input, undefined, {
        sessionId: "deduplicated-validation",
        toolCallId: "validation-first",
      }),
    );
    assert.match(executed.data.run_ref, /^run:\/\//);
    assert.match(executed.data.run_attempt_ref ?? "", /^run-attempt:\/\//);
    assert.equal(executed.data.status, "passed");
    assert.equal(executed.data.filesystem_effects.disposition, "captured");
    assert.match(
      executed.data.filesystem_effects.change_proposal_ref ?? "",
      /^change-proposal:\/\//,
    );
    assert.equal(executed.data.diagnostics[0]?.path, "src/service.ts");
    assert.doesNotMatch(
      executed.data.failures.map(({ message }) => message).join("\n"),
      /supersecretvalue/,
    );
    await assert.rejects(readFile(join(root, "generated.txt")));

    const inspected = success(
      await workspace.inspectRun({
        run_ref: executed.data.run_ref,
        view: "filesystem_effects",
      }),
    );
    assert.deepEqual((inspected.data as { created: string[] }).created, [
      "generated.txt",
    ]);

    const log = success(
      await workspace.inspectArtifact({
        artifact_ref: executed.data.complete_log.ref,
        view: "text",
      }),
    );
    const logContent = String(
      (log.data as unknown as { content: unknown }).content,
    );
    assert.match(logContent, /fixture passed/);
    assert.doesNotMatch(logContent, /supersecretvalue/);

    const proposalRef = executed.data.filesystem_effects.change_proposal_ref;
    assert.ok(proposalRef);
    const review = success(
      await workspace.reviewChange({ proposal_ref: proposalRef }),
    );
    assert.equal(review.data.attached_runs[0]?.run_ref, executed.data.run_ref);
    assert.equal(review.data.checks_not_run.includes("tests"), false);

    const retried = success(
      await workspace.runTask(input, undefined, {
        sessionId: "deduplicated-validation",
        toolCallId: "validation-second",
      }),
    );
    assert.equal(retried.data.run_ref, executed.data.run_ref);
    assert.deepEqual(retried.data.deduplication, {
      reused: true,
      required_state_change: "source_or_environment_revision",
    });
    assert.equal(executor.executions, 1);
    assert.equal(executor.healthChecks, 2);

    const attempt = JSON.parse(
      await readFile(
        join(
          root,
          ".blame",
          "harness",
          "run-attempts",
          `${executed.data.run_attempt_ref?.slice("run-attempt://".length)}.json`,
        ),
        "utf8",
      ),
    ) as { run_ref: string; status: string; tool_call_id: string };
    assert.equal(attempt.status, "passed");
    assert.equal(attempt.run_ref, executed.data.run_ref);
    assert.equal(attempt.tool_call_id, "validation-first");

    const stored = JSON.parse(
      await readFile(
        join(
          root,
          ".blame",
          "harness",
          "runs",
          `${executed.data.run_ref.slice("run://".length)}.json`,
        ),
        "utf8",
      ),
    ) as { logs: { sealed_raw: { ref: string } } };
    await assert.rejects(
      new ArtifactStore(root).get(stored.logs.sealed_raw.ref, {
        audience: "agent",
      }),
      /access policy/i,
    );
  });
});

test("run_task discovers package tasks and normalizes package selections", async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, "apps", "backend"), { recursive: true });
    await writeFile(
      join(root, "apps", "backend", "package.json"),
      JSON.stringify({
        name: "@fixture/backend",
        scripts: { test: "node --test", build: "tsc" },
      }),
    );
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "add backend workspace"]);
    const executor = new RecordingTaskExecutor();
    const workspace = new SemanticWorkspace(root, { taskExecutor: executor });
    const state = success(await workspace.workspaceState());
    const backendTest = state.data.task_catalog.find(
      (task) => task.task_id === "backend:test",
    );
    assert.deepEqual(backendTest, {
      task_id: "backend:test",
      script: "test",
      kind: "test",
      command: "node --test",
      cwd: "apps/backend",
      package_manager: "npm",
      supportsFileSelection: true,
      requiresNetwork: false,
      dependencyPolicy: "required",
    });
    const executed = success(
      await workspace.runTask({
        source_revision_id: state.data.source_revision.source_revision_id,
        task: { kind: "test", target: "backend" },
        selection: { tests: ["apps/backend/tests/unit.test.ts"] },
        limits: { timeout_ms: 10_000, cpu: 2, memory_mb: 512 },
      }),
    );
    assert.equal(executor.lastInput?.cwd.endsWith("/apps/backend"), true);
    assert.deepEqual(executor.lastInput?.args, [
      "run",
      "test",
      "--",
      "tests/unit.test.ts",
    ]);
    assert.deepEqual(executed.data.execution.ignored_limits, [
      "cpu",
      "memory_mb",
    ]);
  });
});

test("run_task diagnoses missing dependencies and exposes a controlled install task", async () => {
  await withWorkspace(async (root) => {
    const missingExecutor = new RecordingTaskExecutor(
      "failed",
      "Error: Cannot find module 'missing-package'\n",
    );
    const workspace = new SemanticWorkspace(root, {
      taskExecutor: missingExecutor,
    });
    const state = success(await workspace.workspaceState());
    assert.equal(
      state.data.task_catalog.some((task) => task.kind === "dependencies"),
      true,
    );
    const failed = success(
      await workspace.runTask({
        source_revision_id: state.data.source_revision.source_revision_id,
        task: { task_id: "test" },
        limits: { timeout_ms: 10_000 },
      }),
    );
    assert.equal(failed.outcome, "blocked");
    assert.equal(failed.reason, "TASK_FAILED");
    assert.equal(
      failed.data.diagnostics.some(
        (diagnostic) => diagnostic.code === "DEPENDENCY_MISSING",
      ),
      true,
    );
    const installExecutor = new RecordingTaskExecutor();
    const installWorkspace = new SemanticWorkspace(root, {
      taskExecutor: installExecutor,
    });
    const install = success(
      await installWorkspace.runTask({
        source_revision_id: state.data.source_revision.source_revision_id,
        task: { kind: "dependencies" },
        limits: { timeout_ms: 10_000 },
      }),
    );
    assert.equal(install.data.status, "passed");
    assert.equal(installExecutor.lastInput?.network, "project_allowlist");
    assert.match(installExecutor.lastInput?.args.join(" ") ?? "", /ci|install/);
  });
});

test("run_task identifies the missing POSIX executable without capturing shell noise", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root, {
      taskExecutor: new RecordingTaskExecutor(
        "failed",
        "sh: line 1: prettier: command not found\n> fixture@test\n",
      ),
    });
    const state = success(await workspace.workspaceState());
    const failed = success(
      await workspace.runTask({
        source_revision_id: state.data.source_revision.source_revision_id,
        task: { task_id: "test" },
        limits: { timeout_ms: 10_000 },
      }),
    );
    const missing = failed.data.diagnostics.filter(
      (diagnostic) => diagnostic.code === "DEPENDENCY_MISSING",
    );
    assert.equal(failed.outcome, "blocked");
    assert.deepEqual(
      missing.map((diagnostic) => diagnostic.dependency),
      ["prettier"],
    );
  });
});

test("run_task persists every terminal status and recovers interrupted attempts", async () => {
  await withWorkspace(async (root) => {
    const statuses = [
      ["passed", "passed"],
      ["failed", "failed"],
      ["timed_out", "timed_out"],
      ["cancelled", "cancelled"],
      ["execution_error", "runtime_error"],
    ] as const;
    for (const [executionStatus, attemptStatus] of statuses) {
      await writeFile(join(root, "run-status.txt"), executionStatus);
      const workspace = new SemanticWorkspace(root, {
        taskExecutor: new RecordingTaskExecutor(executionStatus),
      });
      const revision = success(await workspace.workspaceState()).data
        .source_revision.source_revision_id;
      const result = await workspace.runTask(
        {
          source_revision_id: revision,
          task: { task_id: "test" },
          limits: { timeout_ms: 10_000 },
        },
        undefined,
        { sessionId: "terminal-statuses", toolCallId: executionStatus },
      );
      const run =
        result.status === "success"
          ? result.data
          : (result.error.recovery as { run_attempt_ref?: string });
      assert.equal(
        result.status,
        executionStatus === "execution_error" ? "error" : "success",
      );
      assert.ok(run.run_attempt_ref);
      assert.equal(
        (await readRunAttempt(root, run.run_attempt_ref!)).status,
        attemptStatus,
      );
    }

    const attempts = new RunAttemptStore(root);
    const active = await attempts.start({
      environment: "default",
      identity: "active-attempt",
      revision: "src_active",
      task: { task_id: "test" },
      toolCallId: "active",
    });
    const replacement = await attempts.start({
      environment: "default",
      identity: "replacement-attempt",
      revision: "src_replacement",
      task: { task_id: "test" },
      toolCallId: "replacement",
    });
    assert.equal(
      (await readRunAttempt(root, active.run_attempt_ref)).status,
      "running",
    );
    await attempts.finish(active, "cancelled");
    await attempts.finish(replacement, "cancelled");

    const interrupted = await writeInterruptedRunAttempt(root);
    const recovery = await attempts.start({
      environment: "default",
      identity: "recovery-attempt",
      revision: "src_recovery",
      task: { task_id: "test" },
      toolCallId: "recovery",
    });
    assert.equal(
      (await readRunAttempt(root, interrupted.run_attempt_ref)).status,
      "runtime_error",
    );
    await attempts.finish(recovery, "cancelled");
  });
});

test("apply_change can format touched files with the pinned Prettier version", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: state.data.source_revision.source_revision_id,
        idempotency_key: "format-touched-file",
        operations: [
          {
            kind: "create_file",
            path: "src/formatted.ts",
            content: "export const formatted={value:'ok'}",
          },
        ],
        policies: { format: "touched_files", max_touched_files: 1 },
        checks: ["parse"],
      }),
    );
    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposed.data.proposal_ref,
      }),
    );
    assert.equal(review.data.formatting.policy, "touched_files");
    assert.match(review.data.formatting.formatter_version ?? "", /^3\./);
    assert.deepEqual(review.data.formatting.formatted_files, [
      "src/formatted.ts",
    ]);
    assert.match(review.data.diff, /formatted = \{ value: "ok" \}/);
  });
});

test("native dependency mutation updates the manifest and generated lockfile atomically", async () => {
  await withWorkspace(async (root) => {
    const initialManifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ ...initialManifest, packageManager: "pnpm@10.32.1" }),
    );
    const executor = new LockfileTaskExecutor();
    const workspace = new SemanticWorkspace(root, { taskExecutor: executor });
    const state = success(await workspace.workspaceState());
    const result = success(
      await workspace.mutateDependencies({
        source_revision_id: state.data.source_revision.source_revision_id,
        package_path: "package.json",
        operations: [
          {
            action: "add",
            name: "kleur",
            version: "^4.1.5",
            dependency_type: "dependencies",
          },
        ],
        timeout_ms: 30_000,
      }),
    );
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    );
    assert.equal(manifest.dependencies.kleur, "^4.1.5");
    assert.equal(
      await readFile(join(root, "pnpm-lock.yaml"), "utf8"),
      "generated-lock\n",
    );
    if (!("status" in result.data) || result.data.status !== "applied")
      throw new Error("Expected applied mutation.");
    assert.deepEqual(result.data.changed_files.sort(), [
      "package.json",
      "pnpm-lock.yaml",
    ]);
    assert.equal(result.data.status, "applied");
    assert.equal(result.data.package_manager, "pnpm");
    assert.deepEqual(result.data.network, {
      selected: "project_allowlist",
      enforced: true,
    });
    assert.equal(executor.lastInput?.network, "project_allowlist");
    assert.deepEqual(executor.lastInput?.args, ["install", "--prefer-offline"]);
  });
});

test("generic edit tools refuse manual lockfile changes", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const result = success(
      await workspace.createFile({
        path: "package-lock.json",
        content: "{}\n",
      }),
    );
    assert.equal(result.data.status, "unsupported_operation");
    assert.equal(result.data.recommendedTool, "mutate_dependencies");
  });
});

test("Cline adapter registers a small read/write harness with strict schemas", async () => {
  await withWorkspace(async (root) => {
    const tools = semanticWorkspaceTools(root);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        "workspace_state",
        "search_code",
        "outline_code",
        "inspect_code",
        "get_relation_context",
        "recall_context",
        "edit_symbol",
        "edit_json",
        "patch_file",
        "edit_files",
        "create_file",
        "replace_file",
        "delete_file",
        "move_file",
        "edit_code",
        "mutate_dependencies",
        "run_task",
        "inspect_run",
        "review_change",
        "validate_change",
        "inspect_artifact",
      ],
    );
    assert.equal(
      tools.every((tool) => Boolean(tool.inputSchema)),
      true,
    );
    const stateTool = tools.find((tool) => tool.name === "workspace_state");
    assert.ok(stateTool);
    const result = await stateTool.execute(
      {},
      { agentId: "test", iteration: 1 },
    );
    assert.equal((result as { status?: string }).status, "success");
    const searchTool = tools.find((tool) => tool.name === "search_code");
    assert.ok(searchTool);
    const error = await searchTool.execute(
      {
        query: { kind: "text", pattern: "" },
      },
      { agentId: "test", iteration: 1 },
    );
    assert.equal((error as { isError?: boolean }).isError, false);
    assert.equal(
      (error as { output?: { outcome?: string } }).output?.outcome,
      "failed",
    );
  });
});

test("Cline adapter reuses reads only inside the active context epoch", async () => {
  await withWorkspace(async (root) => {
    const tools = semanticWorkspaceTools(root);
    const inspect = tools.find((tool) => tool.name === "inspect_code");
    const search = tools.find((tool) => tool.name === "search_code");
    assert.ok(inspect);
    assert.ok(search);
    const revision = success(await new SemanticWorkspace(root).workspaceState())
      .data.source_revision.source_revision_id;
    const input = {
      source_revision_id: revision,
      target: { path: "src/service.ts" },
      view: "raw",
    } as const;
    const first = await inspect.execute(input, toolContext("epoch-one"));
    const repeated = await inspect.execute(input, toolContext("epoch-one"));
    const afterCompaction = await inspect.execute(
      input,
      toolContext("epoch-two"),
    );
    const stopped = await inspect.execute(input, toolContext("epoch-two"));
    assert.equal(toolDataStatus(first), "content");
    assert.equal(toolDataStatus(repeated), "already_available");
    assert.equal(toolDataStatus(afterCompaction), "content");
    assert.equal(toolDataStatus(stopped), "already_available");
    assert.notEqual((afterCompaction as { isError?: boolean }).isError, true);
    assert.notEqual((stopped as { isError?: boolean }).isError, true);
    const targeted = await search.execute(
      {
        source_revision_id: revision,
        query: { kind: "text", pattern: "formatName" },
      },
      toolContext("epoch-two"),
    );
    assert.notEqual((targeted as { isError?: boolean }).isError, true);
  });
});

test("cost governor keeps low-novelty observations advisory around edits", () => {
  const governor = new HarnessCostGovernor(8);
  const epoch = { contextEpoch: "epoch-a", iteration: 1 };
  const duplicateRead = {
    status: "success",
    data: {
      status: "already_available",
      overlap_rate: 1,
      new_bytes: 0,
      range_utf8_bytes: [0, 100],
    },
  } as never;
  for (let index = 0; index < 4; index += 1)
    governor.after("inspect_code", {}, duplicateRead, epoch);
  governor.after(
    "edit_code",
    {},
    { status: "success", data: { status: "conflict" } } as never,
    epoch,
  );
  assert.equal(governor.before("search_code", epoch.contextEpoch), undefined);
  governor.after(
    "edit_code",
    {},
    { status: "success", data: { status: "applied" } } as never,
    epoch,
  );
  assert.equal(governor.before("search_code", epoch.contextEpoch), undefined);
  assert.equal(governor.before("search_code", "epoch-b"), undefined);
});

test("cost governor keeps low-novelty counters advisory across execution epochs", () => {
  const governor = new HarnessCostGovernor(20);
  const duplicateRead = {
    status: "success",
    data: {
      status: "already_available",
      overlap_rate: 1,
      new_bytes: 0,
      range_utf8_bytes: [0, 100],
    },
  } as never;
  for (const contextEpoch of ["epoch-a", "epoch-a", "epoch-b", "epoch-b"])
    governor.after("inspect_code", {}, duplicateRead, {
      contextEpoch,
      iteration: 1,
    });
  assert.equal(governor.before("search_code", "epoch-c"), undefined);
});

test("cost telemetry never blocks tools by iteration count", () => {
  const structural = new HarnessCostGovernor(20);
  assert.equal(structural.before("create_file", "epoch", {}, 15), undefined);
  const exploration = new HarnessCostGovernor(20);
  assert.equal(exploration.before("search_code", "epoch", {}, 7), undefined);
  assert.equal(exploration.before("search_code", "epoch", {}, 19), undefined);
  const execution = new HarnessCostGovernor(20);
  assert.equal(execution.before("edit_code", "epoch", {}, 12), undefined);
  assert.equal(execution.before("run_task", "epoch", {}, 19), undefined);
  assert.equal(execution.before("run_task", "epoch", {}, 20), undefined);
  assert.equal(execution.before("run_task", "epoch", {}, 2_000), undefined);
});

test("cost governor leaves late structural mutations available", () => {
  const governor = new HarnessCostGovernor(20);
  assert.equal(
    governor.before(
      "edit_files",
      "epoch",
      {
        operations: [
          { operation: "create_file", path: "src/new.ts", content: "" },
        ],
      },
      15,
    ),
    undefined,
  );
  assert.equal(
    governor.before("mutate_dependencies", "epoch", {}, 15),
    undefined,
  );
  assert.equal(
    governor.before(
      "edit_files",
      "epoch",
      {
        operations: [
          { operation: "replace_file", path: "src/current.ts", content: "" },
        ],
      },
      15,
    ),
    undefined,
  );
});

test("cost telemetry never blocks retries by failure count", () => {
  const governor = new HarnessCostGovernor(20);
  const input = { query: "missing" };
  for (let index = 0; index < 3; index += 1)
    governor.after(
      "inspect_code",
      input,
      {
        status: "error",
        error: { code: "IO_ERROR", message: "failed" },
      } as never,
      { contextEpoch: "epoch", iteration: index },
    );
  assert.equal(governor.before("inspect_code", "epoch", input, 4), undefined);
  assert.equal(
    governor.before("inspect_code", "new-epoch", input, 4),
    undefined,
  );
  governor.newUserRequest();
  assert.equal(governor.before("inspect_code", "epoch", input, 1), undefined);
});

test("Cline adapter can delegate semantic execution without changing its tool contract", async () => {
  const requests: unknown[] = [];
  const tools = semanticWorkspaceTools(
    "/home/blame/.local/share/blame/runtime/worktrees/project/story-US-1-test",
    {
      taskContract: { session_id: "session-1", story_id: "US-1" },
      executor: async (request) => {
        requests.push(request);
        return harnessSuccess({
          data: {},
          revision: {
            source_revision_id: "src_delegated_contract",
          },
          startedAt: Date.now(),
          provenance: [],
        });
      },
    },
  );
  const stateTool = tools.find((tool) => tool.name === "workspace_state");
  assert.ok(stateTool);
  await stateTool.execute({}, { agentId: "test", iteration: 1 });
  assert.deepEqual(requests, [
    {
      input: {},
      taskContract: { session_id: "session-1", story_id: "US-1" },
      tool: "workspace_state",
      toolContext: { contextEpoch: "session-1:epoch:0" },
      workspaceRoot:
        "/home/blame/.local/share/blame/runtime/worktrees/project/story-US-1-test",
    },
  ]);
});

test("Cline adapter suppresses completed managed reads only for the same consumer context", async () => {
  await withWorkspace(async (root) => {
    let executions = 0;
    const tools = semanticWorkspaceTools(root, {
      taskContract: { session_id: "managed-cache" },
      executor: async () => {
        executions += 1;
        return harnessSuccess({
          data: { status: "content", content: "export const value = 1" },
          revision: { source_revision_id: "src_managed" },
          startedAt: Date.now(),
          provenance: [],
        });
      },
    });
    const inspect = tools.find((tool) => tool.name === "inspect_code");
    assert.ok(inspect);
    const input = { target: { path: "src/service.ts" }, view: "raw" };
    const lead = { agentId: "lead", conversationId: "managed-cache" } as never;
    const specialist = {
      agentId: "specialist",
      conversationId: "specialist-context",
    } as never;
    await inspect.execute(input, lead);
    const repeated = await inspect.execute(input, lead);
    await inspect.execute(input, specialist);
    assert.equal(executions, 2);
    assert.equal(toolDataStatus(repeated), "already_available");
  });
});

test("Cline adapter reuses the initial briefing instead of refetching unchanged state", async () => {
  await withWorkspace(async (root) => {
    const revision = success(await new SemanticWorkspace(root).workspaceState())
      .data.source_revision.source_revision_id;
    let executions = 0;
    const tools = semanticWorkspaceTools(root, {
      initialTaskBriefing: JSON.stringify({
        source_revision: { source_revision_id: revision },
      }),
      executor: async () => {
        executions += 1;
        return harnessSuccess({
          data: { changes: [] },
          revision: { source_revision_id: revision },
          startedAt: Date.now(),
          provenance: [],
        });
      },
    });
    const state = tools.find((tool) => tool.name === "workspace_state");
    assert.ok(state);
    const reused = await state.execute({}, { agentId: "lead" } as never);
    await state.execute({ include: ["changes"] }, { agentId: "lead" } as never);
    assert.equal(toolDataStatus(reused), "already_available");
    assert.equal(executions, 1);
  });
});

test("Cline adapter converts malformed delegated envelopes into recoverable IPC failures", async () => {
  const tools = semanticWorkspaceTools("/workspace", {
    executor: async () => ({ status: "success" }) as never,
  });
  const stateTool = tools.find((tool) => tool.name === "workspace_state");
  assert.ok(stateTool);
  const result = await stateTool.execute({}, { agentId: "test", iteration: 1 });
  assert.equal((result as { isError?: boolean }).isError, false);
  const output = (result as { output?: Record<string, unknown> }).output;
  assert.equal(output?.outcome, "failed");
  assert.equal(output?.fatal, false);
  assert.equal(output?.reason, "EXECUTION_ERROR");
});

test("Cline adapter applies output budgets after the complete harness envelope", async () => {
  const tools = semanticWorkspaceTools("/workspace", {
    executor: async () =>
      harnessSuccess({
        data: { items: Array.from({ length: 100 }, () => "x".repeat(500)) },
        revision: {
          source_revision_id: "src_00000000000000000000000000000000",
        },
        startedAt: Date.now(),
        provenance: [],
      }),
  });
  const search = tools.find((tool) => tool.name === "search_code");
  assert.ok(search);
  const result = await search.execute(
    {
      query: { kind: "text", pattern: "value" },
      budget: { max_output_tokens: 200 },
    },
    { agentId: "test", iteration: 1 },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 800);
});

test("managed semantic execution is limited to remote local-container sessions", async () => {
  const requests: unknown[] = [];
  const executor: CanonicalSemanticWorkspaceExecutor = async (request) => {
    requests.push(request);
    return { status: "success" } as never;
  };
  assert.equal(
    managedSemanticWorkspaceExecutor(executor, {
      backendMode: "local",
      workspaceMode: "cloud-mirror",
    }),
    undefined,
  );
  const managed = managedSemanticWorkspaceExecutor(executor, {
    backendMode: "remote",
    workspaceMode: "local-container",
  });
  assert.ok(managed);
  await managed({
    input: {},
    tool: "workspace_state",
    workspaceRoot: "/home/blame/.local/share/blame/runtime/worktrees/project",
  });
  assert.deepEqual(requests, [
    {
      execution: {
        backendMode: "remote",
        workspaceMode: "local-container",
      },
      input: {},
      tool: "workspace_state",
      workspaceRoot: "/home/blame/.local/share/blame/runtime/worktrees/project",
    },
  ]);
});

test("commit_proposal refuses an unrelated concurrent workspace change", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "stale-proposal",
        operations: [
          {
            kind: "replace_node",
            target: target.symbol_ref,
            replacement:
              "function formatName(value: string) { return value.toUpperCase(); }",
          },
        ],
      }),
    );

    await writeFile(join(root, "README.md"), "concurrent change\n");
    const committed = await workspace.applyChange({
      action: "commit_proposal",
      proposal_ref: proposed.data.proposal_ref,
      expected_base_source_revision_id: revision,
      idempotency_key: "stale-commit",
    });
    assert.equal(committed.status, "error");
    if (committed.status === "error")
      assert.equal(committed.error.code, "STALE_REVISION");
    assert.equal(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      source,
    );
  });
});

test(
  "apply_change refuses write paths whose parent symlink escapes the workspace",
  { skip: process.platform === "win32" },
  async () => {
    await withWorkspace(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "blame-harness-outside-"));
      try {
        await symlink(outside, join(root, "linked"), "dir");
        const workspace = new SemanticWorkspace(root);
        const state = success(await workspace.workspaceState());
        const revision = state.data.source_revision.source_revision_id;
        const proposed = success(
          await workspace.applyChange({
            action: "propose",
            base_source_revision_id: revision,
            idempotency_key: "symlink-escape-proposal",
            operations: [
              {
                kind: "create_file",
                path: "linked/escaped.ts",
                content: "export {};\n",
              },
            ],
          }),
        );
        const committed = await workspace.applyChange({
          action: "commit_proposal",
          proposal_ref: proposed.data.proposal_ref,
          expected_base_source_revision_id: revision,
          idempotency_key: "symlink-escape-commit",
        });
        assert.equal(committed.status, "error");
        if (committed.status === "error")
          assert.equal(committed.error.code, "POLICY_DENIED");
        await assert.rejects(readFile(join(outside, "escaped.ts")));
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  },
);

test("outline_code returns compact symbols across priority languages and Vue", async () => {
  await withWorkspace(async (root) => {
    const fixtures = new Map([
      [
        "src/example.py",
        "class Worker:\n    def run(self):\n        return True\n",
      ],
      ["src/example.go", "package main\nfunc Run() {}\n"],
      ["src/Example.java", "class Example { void run() {} }\n"],
      ["src/example.cs", "class Example { void Run() {} }\n"],
      ["src/example.rs", "struct Worker;\nimpl Worker { fn run() {} }\n"],
      ["src/example.sh", "run() { echo ready; }\n"],
      [
        "src/example.vue",
        '<template><div /></template>\n<script setup lang="ts">\nfunction run() { return true }\n</script>\n',
      ],
      [
        "src/many.ts",
        Array.from(
          { length: 20 },
          (_, index) => `function task${index}() {}`,
        ).join("\n"),
      ],
    ]);
    for (const [path, content] of fixtures)
      await writeFile(join(root, path), content);
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    for (const [path, expected] of [
      ["src/example.py", "Worker.run"],
      ["src/example.go", "Run"],
      ["src/Example.java", "Example.run"],
      ["src/example.cs", "Example.Run"],
      ["src/example.rs", "Worker"],
      ["src/example.sh", "run"],
      ["src/example.vue", "run"],
    ]) {
      const outline = success(
        await workspace.outlineCode({
          source_revision_id: revision,
          target: { path },
        }),
      );
      assert.equal(
        outline.data.items.some((item) => item.qualified_name === expected),
        true,
        `${path} should expose ${expected}`,
      );
    }
    const compact = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/many.ts" },
      }),
    );
    assert.equal(compact.data.items.length, 20);
    assert.equal(compact.coverage.truncated, false);
    assert.equal(
      compact.data.items.every(
        (item) => item.symbol_ref.length < 260 && !("node_ref" in item),
      ),
      true,
    );
    const vueSymbol = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/example.vue" },
      }),
    ).data.items.find((item) => item.qualified_name === "run");
    assert.ok(vueSymbol);
    const body = success(
      await workspace.inspectCode({
        source_revision_id: revision,
        target: { symbol_ref: vueSymbol.symbol_ref },
        view: "body",
      }),
    );
    assert.match(body.data.content, /return true/);
    const pythonSymbol = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/example.py" },
      }),
    ).data.items.find((item) => item.qualified_name === "Worker.run");
    assert.ok(pythonSymbol);
    const fallback = success(
      await workspace.getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: pythonSymbol.symbol_ref },
      }),
    );
    assert.equal(fallback.data.engine, "ripgrep");
    if (fallback.data.engine !== "ripgrep") assert.fail("Expected fallback");
    assert.equal(fallback.data.fallback_reason, "unsupported_language");
    assert.equal(fallback.coverage.analysis, "heuristic");
  });
});

test("compiler relations infer a TypeScript project without configuration", async () => {
  await withWorkspace(async (root) => {
    await writeFile(
      join(root, "src", "consumer.ts"),
      'import { formatName } from "./service";\nformatName("Ada");\n',
    );
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.name === "formatName",
    );
    assert.ok(target);
    const relations = success(
      await workspace.getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: target.symbol_ref },
      }),
    );
    if (relations.data.engine !== "typescript")
      assert.fail(JSON.stringify(relations.data));
    assert.equal(relations.data.project_kind, "inferred");
    assert.equal(relations.data.analysis, "exact");
    assert.equal(
      relations.data.items.some((item) => item.relation === "calls"),
      true,
    );
  });
});

test("P1 relation and impact views stay bounded and identify tests", async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, "tests"), { recursive: true });
    await writeFile(
      join(root, "tests", "service.test.ts"),
      'import { formatName } from "../src/service";\nformatName("Ada");\n',
    );
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          module: "ESNext",
          moduleResolution: "Bundler",
          paths: { "@core/*": ["src/*"] },
        },
        include: ["src", "tests"],
      }),
    );
    await writeFile(
      join(root, "src", "consumer.ts"),
      'import { formatName as normalize } from "@core/service";\nnormalize("Ada");\n',
    );
    await writeFile(
      join(root, "src", "unrelated.ts"),
      'function formatName(value: string) { return value; }\nformatName("Noise");\n',
    );
    await writeFile(
      join(root, "src", "state.ts"),
      "export let count = 0;\ncount += 1;\nconsole.log(count);\n",
    );
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    const relations = success(
      await workspace.getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: target.symbol_ref },
      }),
    );
    assert.equal(relations.data.analysis, "exact");
    if (relations.data.engine !== "typescript")
      assert.fail(JSON.stringify(relations.data));
    assert.equal(relations.data.cache.hit, false);
    assert.equal(relations.data.project_kind, "configured");
    assert.equal(relations.coverage.analysis, "exact");
    assert.match(relations.subject_revision.index_revision_id ?? "", /^idx_/);
    assert.equal(
      relations.data.items.some((item) => item.relation === "calls"),
      true,
    );
    assert.equal(
      relations.data.items.some((item) => item.relation === "tested_by"),
      true,
    );
    assert.equal(
      relations.data.items.some((item) => item.relation === "imports"),
      true,
    );
    assert.equal(
      relations.data.items.some((item) => item.path === "src/unrelated.ts"),
      false,
    );
    const cachedRelations = success(
      await new SemanticWorkspace(root).getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: target.symbol_ref },
      }),
    );
    if (cachedRelations.data.engine !== "typescript")
      assert.fail(JSON.stringify(cachedRelations.data));
    assert.equal(cachedRelations.data.cache.hit, true);
    const boundedRelations = success(
      await workspace.getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: target.symbol_ref },
        include: ["node_refs"],
        max_results: 1,
      }),
    );
    assert.equal(boundedRelations.data.items.length, 1);
    assert.match(
      boundedRelations.data.items[0]?.match_ref ?? "",
      /^m_[a-z0-9]{2,10}$/,
    );
    assert.match(
      boundedRelations.data.items[0]?.node_ref ?? "",
      /^n_[a-z0-9]{2,10}$/,
    );
    assert.equal(boundedRelations.coverage.truncated, true);
    const stateOutline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/state.ts" },
      }),
    );
    const count = stateOutline.data.items.find((item) => item.name === "count");
    assert.ok(count);
    const access = success(
      await workspace.getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: count.symbol_ref },
        relations: ["reads", "writes"],
      }),
    );
    assert.equal(
      access.data.items.some((item) => item.relation === "reads"),
      true,
    );
    assert.equal(
      access.data.items.some((item) => item.relation === "writes"),
      true,
    );
    const proposal = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "p1-impact-proposal",
        operations: [
          {
            kind: "replace_node",
            target: target.symbol_ref,
            replacement:
              "function formatName(value: string) { return value.trim().toUpperCase(); }",
          },
        ],
      }),
    );
    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposal.data.proposal_ref,
        include: ["semantic_diff", "impact"],
      }),
    );
    assert.ok(review.data.semantic_diff);
    assert.ok(review.data.impact);
    assert.equal(
      review.data.semantic_diff[0]?.modified[0]?.change,
      "implementation",
    );
    assert.equal(
      review.data.impact.impacted_files.some(
        (file) => file.path === "tests/service.test.ts" && file.test,
      ),
      true,
    );
    await writeFile(
      join(root, "src", "consumer.ts"),
      'import { formatName } from "@core/service";\nformatName("Grace");\n',
    );
    const rebased = success(
      await workspace.getRelationContext({
        source_revision_id: revision,
        target: { symbol_ref: target.symbol_ref },
      }),
    );
    assert.equal(rebased.data.analysis, "exact");
  });
});

test("validate_change binds exact revision runs to acceptance criteria", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root, {
      taskExecutor: new RecordingTaskExecutor(),
    });
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    const applied = success(
      await workspace.applyChange({
        action: "apply",
        base_source_revision_id: revision,
        idempotency_key: "p1-validation-apply",
        operations: [
          {
            kind: "replace_node",
            target: target.symbol_ref,
            replacement:
              "function formatName(value: string) { return value.trim().toUpperCase(); }",
          },
        ],
        checks: ["parse"],
      }),
    );
    const candidateRevision =
      applied.data.receipt.source_revision.source_revision_id;
    await workspace.runTask({
      source_revision_id: candidateRevision,
      task: { task_id: "test" },
      limits: { timeout_ms: 10_000 },
      idempotency_key: "p1-validation-test",
    });
    const validation = success(
      await workspace.validateChange({
        proposal_ref: applied.data.proposal.proposal_ref,
        criteria: [
          {
            id: "AC1",
            text: "Formatting behavior remains covered.",
            requires: ["parse", "test"],
          },
        ],
      }),
    );
    assert.equal(validation.data.criteria[0]?.status, "verified");
    assert.equal(validation.data.summary.complete, true);
    assert.match(validation.data.evidence_ref, /^artifact:\/\//);
  });
});

const source = `export class Greeter {
  greet(name: string) {
    return \`Hello \${formatName(name)}\`;
  }
}

export function formatName(value: string) {
  return value.trim();
}
`;

async function withWorkspace(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-harness-test-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "node --test", typecheck: "tsc --noEmit" },
      }),
    );
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "service.ts"), source);
    if (process.platform !== "win32")
      await chmod(join(root, "src", "service.ts"), 0o755);
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "harness@example.com"]);
    await git(root, ["config", "user.name", "Harness Test"]);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function benchmarkObservation(
  tool: string,
  offsetMs: number,
  options: {
    cacheHit?: boolean;
    cause?: HarnessToolObservation["result_cause"];
    effect?: HarnessToolObservation["effect"];
    environmentRepair?: boolean;
    errorSignature?: string;
  } = {},
): HarnessToolObservation {
  return {
    cache_usage: {
      hit: options.cacheHit ?? false,
      kind: options.cacheHit ? "receipt" : "none",
    },
    duration: 10,
    effect: options.effect ?? "observed",
    environment_revision_id: "env_current",
    environment_repair: options.environmentRepair ?? false,
    error_signature: options.errorSignature ?? null,
    evidence_produced: [],
    input_tokens: 10,
    normalized_input_digest:
      tool === "inspect_code" ? "same-read" : `${tool}-input`,
    output_tokens: 20,
    result_cause: options.cause ?? "none",
    source_revision_id: "src_current",
    started_at: new Date(offsetMs).toISOString(),
    target: "src/service.ts",
    tool,
  };
}

function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

function storedProposalPath(root: string, ref: string) {
  return join(
    root,
    ".blame",
    "harness",
    "proposals",
    `${ref.slice("change-proposal://".length)}.json`,
  );
}

async function exists(path: string) {
  try {
    await stat(path);
    return 1;
  } catch {
    return 0;
  }
}

async function fileDigest(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

async function readRunAttempt(root: string, ref: string) {
  return JSON.parse(
    await readFile(
      join(
        root,
        ".blame",
        "harness",
        "run-attempts",
        `${ref.slice("run-attempt://".length)}.json`,
      ),
      "utf8",
    ),
  ) as { status: string };
}

async function writeInterruptedRunAttempt(root: string) {
  const digest = createHash("sha256")
    .update("interrupted-attempt")
    .digest("hex");
  const runAttemptRef = `run-attempt://${digest}`;
  const directory = join(root, ".blame", "harness", "run-attempts");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, `${digest}.json`),
    JSON.stringify({
      schema_version: "2.0",
      run_attempt_ref: runAttemptRef,
      tool_call_id: "interrupted",
      revision: "src_interrupted",
      task: { task_id: "test" },
      environment: "default",
      status: "running",
      started_at: new Date(0).toISOString(),
    }),
  );
  return { run_attempt_ref: runAttemptRef };
}

function success<T>(result: HarnessToolResult<T>): HarnessToolSuccess<T> {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

function parseContinuityCapsule(value: string) {
  const content = value.match(
    /<continuity_capsule>\n([\s\S]*?)\n<\/continuity_capsule>/u,
  )?.[1];
  assert.ok(content);
  return JSON.parse(content) as {
    conversationId: string;
    executionEpochId: string;
    currentRequest?: string;
    relevantConstraints: Array<{ value: string }>;
  };
}

function toolDataStatus(result: unknown) {
  return (result as { data?: { status?: string } }).data?.status;
}

function toolContext(messageId: string) {
  return {
    agentId: "test",
    conversationId: "conversation",
    iteration: 1,
    snapshot: {
      agentId: "test",
      conversationId: "conversation",
      iteration: 1,
      messages: [
        { content: [], createdAt: 0, id: messageId, role: "user" as const },
      ],
      pendingToolCalls: [],
      status: "running" as const,
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    },
  };
}

class RecordingTaskExecutor implements TaskExecutor {
  executions = 0;
  healthChecks = 0;
  lastInput?: TaskExecutionInput;
  private readonly status: TaskExecutionResult["status"];
  private readonly stdout?: string;

  constructor(
    status: TaskExecutionResult["status"] = "passed",
    stdout?: string,
  ) {
    this.status = status;
    this.stdout = stdout;
  }

  async capability() {
    return "sandbox_exec" as const;
  }

  async dependencyCapability() {
    return { available: true, network: "managed_allowlist" as const };
  }

  async healthCheck() {
    this.healthChecks += 1;
    return { available: true, isolation: "sandbox_exec" as const };
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    this.executions += 1;
    this.lastInput = input;
    await writeFile(join(input.overlayRoot, "generated.txt"), "generated\n");
    return {
      status: this.status,
      exitCode: this.status === "passed" ? 0 : 1,
      signal: null,
      stdout:
        this.stdout ??
        `${join(input.overlayRoot, "src", "service.ts")}:2:3 warning fixture passed\nerror token=supersecretvalue\n`,
      stderr: "",
      outputTruncated: false,
      isolation: "sandbox_exec",
    };
  }
}

class LockfileTaskExecutor implements TaskExecutor {
  lastInput?: TaskExecutionInput;

  async capability() {
    return "sandbox_exec" as const;
  }

  async dependencyCapability() {
    return { available: true, network: "managed_allowlist" as const };
  }

  async healthCheck() {
    return { available: true, isolation: "sandbox_exec" as const };
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    this.lastInput = input;
    await materializeTestDependencies(input.overlayRoot);
    const lockfile =
      input.packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
    await writeFile(join(input.overlayRoot, lockfile), "generated-lock\n");
    return {
      status: "passed",
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      outputTruncated: false,
      isolation: "sandbox_exec",
      packageManagerResolution: {
        name: input.packageManager ?? "npm",
        resolvedVersion: input.packageManagerVersion ?? "10.0.0",
        strategy: input.packageManagerVersion ? "exact" : "unversioned",
      },
    };
  }
}

async function materializeTestDependencies(root: string) {
  const manifest = JSON.parse(
    await readFile(join(root, "package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
  };
  await mkdir(join(root, "node_modules", ".pnpm"), { recursive: true });
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const directory = join(root, "node_modules", name);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ name, main: "index.js" }),
    );
    await writeFile(join(directory, "index.js"), "export default true\n");
  }
}
