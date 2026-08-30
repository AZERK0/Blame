import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CanonicalResultMapper } from "./protocol-v3-adapter.js";
import { harnessSuccess, provenance } from "./protocol.js";
import { semanticWorkspaceTools } from "./cline-tools.js";
import {
  canonicalSemanticWorkspaceExecutor,
  localSemanticWorkspaceExecutor,
} from "./semantic-executor.js";
import {
  clineAdapterCapabilities,
  headlessAdapterCapabilities,
  runAdapterConformance,
} from "./adapter-conformance.js";
import {
  harnessFeatureDefinitions,
  harnessFeatureEnabled,
} from "./harness-feature-flags.js";
import {
  RunLifecycleRegistry,
  completionAwareTerminalState,
} from "./run-lifecycle.js";
import { RecoveryController } from "./recovery-controller.js";
import { WorkspaceFiles } from "./workspace-files.js";

test("canonical result mapper rejects unproven effects", () => {
  const mapper = new CanonicalResultMapper();
  const result = mapper.map(
    legacySuccess({ status: "applied", changed: true }),
    resultContext("edit_files"),
  );
  assert.equal(result.outcome, "blocked");
  if (result.outcome === "blocked") assert.equal(result.issue.code, "APPLIED");
});

test("canonical result mapper preserves specialized edit payloads and receipts", () => {
  const mapper = new CanonicalResultMapper();
  const data = {
    status: "applied",
    changed: true,
    receipt_ref: "changeset://one",
    groups: [],
  };
  const result = mapper.map(legacySuccess(data), resultContext("edit_files"));
  assert.equal(result.outcome, "completed");
  assert.equal(result.effect, "changed");
  assert.equal(result.data, data);
  assert.deepEqual(result.evidence, ["changeset://one"]);
});

test("canonical result mapper accepts demonstrated idempotence", () => {
  const mapper = new CanonicalResultMapper();
  const result = mapper.map(
    legacySuccess({
      status: "no_change",
      postcondition_satisfied: true,
      postcondition_evidence_ref: "evidence://postcondition/one",
    }),
    resultContext("edit_files"),
  );
  assert.equal(result.outcome, "completed");
  assert.equal(result.effect, "none");
});

test("Cline adapter publishes domain blocks as transport successes", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-v3-cline-"));
  try {
    await writeFile(join(root, "package.json"), '{"scripts":{}}\n');
    const tool = semanticWorkspaceTools(root, { protocolVersion: "3" }).find(
      ({ name }) => name === "inspect_code",
    );
    assert.ok(tool);
    const result = await tool.execute(
      { target: { path: "missing.ts" }, view: "raw" },
      { agentId: "test", iteration: 1, runId: "run-one" },
    );
    assert.equal(
      (result as { protocol_version?: string }).protocol_version,
      "3",
    );
    assert.equal((result as { outcome?: string }).outcome, "blocked");
    assert.equal(
      (result as { issue?: { kind?: string } }).issue?.kind,
      "invalid_direct_input",
    );
    assert.equal(Object.hasOwn(result as object, "isError"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cline v3 suppresses repeated invalid input until input changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-v3-invalid-retry-"));
  try {
    await writeFile(join(root, "package.json"), '{"scripts":{}}\n');
    const tool = semanticWorkspaceTools(root, { protocolVersion: "3" }).find(
      ({ name }) => name === "inspect_code",
    );
    assert.ok(tool);
    const input = { target: { path: "package.json" }, view: "body" };
    const context = { agentId: "test", iteration: 1, runId: "invalid-run" };
    const first = await tool.execute(input, context);
    const second = await tool.execute(input, { ...context, iteration: 2 });
    assert.equal(
      (first as { issue?: { code?: string } }).issue?.code,
      "INVALID_INPUT",
    );
    assert.equal(
      (second as { issue?: { code?: string } }).issue?.code,
      "RECOVERY_CONDITION_NOT_SATISFIED",
    );
    const changed = await tool.execute(
      { target: { path: "package.json" }, view: "raw" },
      { ...context, iteration: 3 },
    );
    assert.equal((changed as { outcome?: string }).outcome, "completed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cline v3 suppresses equivalent retries until the source changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-v3-retry-"));
  try {
    await writeFile(join(root, "package.json"), '{"scripts":{}}\n');
    const files = new WorkspaceFiles(root);
    let executions = 0;
    const executor = async () => {
      executions += 1;
      const revision = (await files.snapshot()).revision;
      return harnessSuccess({
        data:
          executions === 1
            ? { status: "conflict" }
            : { status: "completed", content: "current" },
        revision,
        startedAt: Date.now(),
        provenance: [provenance("harness", revision)],
        outcome: executions === 1 ? "blocked" : "completed",
        reason: executions === 1 ? "STALE_SOURCE_REVISION" : "COMPLETED",
      });
    };
    const tool = semanticWorkspaceTools(root, {
      executor,
      protocolVersion: "3",
    }).find(({ name }) => name === "inspect_code");
    assert.ok(tool);
    const input = { target: { path: "package.json" }, view: "raw" };
    const context = { agentId: "test", iteration: 1, runId: "run-retry" };
    const first = await tool.execute(input, context);
    const second = await tool.execute(input, { ...context, iteration: 2 });
    assert.equal((first as { outcome?: string }).outcome, "blocked");
    assert.equal(
      (second as { issue?: { code?: string } }).issue?.code,
      "RECOVERY_CONDITION_NOT_SATISFIED",
    );
    assert.equal(executions, 1);
    await writeFile(join(root, "changed.ts"), "export const changed = true;\n");
    const third = await tool.execute(input, { ...context, iteration: 3 });
    assert.equal((third as { outcome?: string }).outcome, "completed");
    assert.equal(executions, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cline and headless adapters satisfy the same Core scenario", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-v3-conformance-"));
  try {
    await writeFile(join(root, "package.json"), '{"scripts":{}}\n');
    const headless = canonicalSemanticWorkspaceExecutor(
      localSemanticWorkspaceExecutor(root),
    );
    const clineTools = semanticWorkspaceTools(root, {
      executor: localSemanticWorkspaceExecutor(root),
      protocolVersion: "3",
    });
    const cline = async (request: Parameters<typeof headless>[0]) => {
      const tool = clineTools.find(({ name }) => name === request.tool);
      assert.ok(tool);
      return tool.execute(request.input, {
        agentId: "conformance",
        iteration: 1,
        runId: "conformance-execution",
      }) as ReturnType<typeof headless>;
    };
    const request = {
      input: { target: { path: "missing.ts" }, view: "raw" },
      tool: "inspect_code" as const,
      workspaceRoot: root,
      toolContext: { executionId: "conformance-execution" },
    };
    const results = await runAdapterConformance(
      [
        { capabilities: headlessAdapterCapabilities, execute: headless },
        { capabilities: clineAdapterCapabilities, execute: cline },
      ],
      [
        {
          scenario_id: "missing-inspection",
          request,
          assert: (result) => assert.equal(result.outcome, "blocked"),
        },
      ],
    );
    assert.equal(results.length, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Cline accepts canonical results from the managed bridge", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-v3-managed-"));
  try {
    await writeFile(join(root, "package.json"), '{"scripts":{}}\n');
    const executor = canonicalSemanticWorkspaceExecutor(
      localSemanticWorkspaceExecutor(root),
    );
    const tool = semanticWorkspaceTools(root, {
      executor,
      protocolVersion: "3",
    }).find(({ name }) => name === "workspace_state");
    assert.ok(tool);
    const result = await tool.execute(
      {},
      {
        agentId: "managed-bridge",
        iteration: 1,
        runId: "managed-bridge",
      },
    );
    assert.equal(
      (result as { protocol_version?: string }).protocol_version,
      "3",
    );
    assert.equal((result as { outcome?: string }).outcome, "completed");
    assert.equal((result as { effect?: string }).effect, "observed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("runtime recovery fingerprint observes dependency installation", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-v3-runtime-state-"));
  try {
    const controller = new RecoveryController(new WorkspaceFiles(root));
    const context = { agentId: "runtime-state", iteration: 1 };
    const before = controller.environmentFingerprint(context);
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules/runtime-marker"), "available\n");
    const after = controller.environmentFingerprint(context);
    assert.notEqual(after, before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical bridge results retain the requested output bound", async () => {
  const executor = canonicalSemanticWorkspaceExecutor(async () =>
    harnessSuccess({
      data: { items: Array.from({ length: 100 }, () => "x".repeat(500)) },
      revision: { source_revision_id: "src_current" },
      startedAt: Date.now(),
      provenance: [],
    }),
  );
  const tool = semanticWorkspaceTools("/workspace", {
    executor,
    protocolVersion: "3",
  }).find(({ name }) => name === "search_code");
  assert.ok(tool);
  const result = await tool.execute(
    {
      query: { kind: "text", pattern: "value" },
      budget: { max_output_tokens: 200 },
    },
    { agentId: "canonical-budget", iteration: 1 },
  );
  assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 800);
});

test("legacy max iteration reason is terminal failure, not a lifecycle state", () => {
  const lifecycles = new RunLifecycleRegistry();
  lifecycles.begin("session", "execution");
  assert.equal(
    lifecycles.finish("session", "execution", "max_iterations"),
    true,
  );
  const state = lifecycles.state("session");
  assert.equal(state?.state, "failed");
  assert.equal(state?.terminal_reason, "max_iterations");
  lifecycles.begin("mistake-session", "mistake-execution");
  assert.equal(
    lifecycles.finish("mistake-session", "mistake-execution", "mistake_limit"),
    true,
  );
  assert.equal(
    lifecycles.state("mistake-session")?.terminal_reason,
    "mistake_limit",
  );
});

test("Cline cannot retain a succeeded terminal after failed verification", () => {
  assert.equal(
    completionAwareTerminalState("succeeded", {
      source_revision_id: "src_current",
      delivery: "satisfied",
      verification: "failed",
      satisfied_obligations: [],
      missing_obligations: [],
      failed_obligations: ["obligation://failed"],
      reservations: [],
    }),
    "failed",
  );
});

test("feature flag inventory is complete and protocol rollback is explicit", () => {
  const definitions = harnessFeatureDefinitions();
  assert.equal(
    definitions.every(
      (definition) =>
        definition.owner &&
        definition.removal_criterion &&
        definition.deadline &&
        definition.tests.length > 0 &&
        definition.metrics.length > 0,
    ),
    true,
  );
  assert.equal(
    harnessFeatureEnabled("BLAME_HARNESS_PROTOCOL_V3", {
      BLAME_HARNESS_PROTOCOL_V3: "false",
    }),
    false,
  );
});

function legacySuccess<T>(data: T) {
  const revision = {
    source_revision_id: "src_0123456789abcdef0123456789abcdef",
  };
  return harnessSuccess({
    data,
    revision,
    startedAt: Date.now(),
    provenance: [provenance("harness", revision)],
  });
}

function resultContext(tool: string) {
  return { executionId: "execution", toolCallId: "tool-call", tool };
}
