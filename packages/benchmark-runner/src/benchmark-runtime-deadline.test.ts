import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import test, { type TestContext } from "node:test";
import { runtimeFactory } from "./benchmark-run.js";
import type { BenchmarkConfig } from "./contracts.js";

type RuntimeInternals = {
  options: { createCore?: () => Promise<never> };
  sessionLogWrites: Map<string, Promise<void>>;
};

for (const harness of ["blame", "cline"] as const) {
  test(`${harness} keeps a silent model within the explicit benchmark budget`, async (context) => {
    await verifySilentModelBudget(context, harness);
  });
}

async function verifySilentModelBudget(context: TestContext, harness: BenchmarkConfig["harness"]) {
  const workspace = await mkdtemp(join(tmpdir(), "benchmark-runtime-budget-"));
  const config = fixtureConfig(workspace, harness);
  const runtime = runtimeFactory({ emit() {} }, harness, config);
  const internals = runtime as unknown as RuntimeInternals;
  let aborted = 0;
  internals.options.createCore = async () => silentCore(() => { aborted += 1; }) as never;
  context.mock.method(globalThis, "fetch", async () => credentialResponse());
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const { sessionId } = await runtime.sessions.startDevelopment({
      apiConnection: { url: config.apiUrl }, cwd: workspace, workspaceRoot: workspace,
      providerId: config.providerId, modelId: config.modelId, reasoningEffort: "high",
      summary: config.instruction, title: config.taskId,
    });
    for (let window = 0; window < 2; window += 1) {
      context.mock.timers.tick(240_001);
      await flushLogs(internals);
    }
    assert.equal(aborted, 0, "The runtime imposed a hidden deadline before the benchmark budget");
    await runtime.sessions.abort(sessionId);
    assert.equal(aborted, 1, "Explicit cancellation must remain effective");
  } finally {
    context.mock.timers.reset();
    await runtime.shutdown();
    await rm(workspace, { recursive: true, force: true });
  }
}

async function flushLogs(runtime: RuntimeInternals) {
  await Promise.all([...runtime.sessionLogWrites.values()]);
  await setImmediate();
}

function silentCore(abort: () => void) {
  return { async abort() { abort(); }, async stop() {}, async dispose() {},
    async list() { return []; }, async subscribe() { return () => undefined; },
    async start() { return new Promise<never>(() => undefined); } };
}

function credentialResponse() {
  return new Response(JSON.stringify({ data: { apiKey: "offline-fixture", authMethod: "api-key",
    baseUrl: null, id: "fixture", label: "default", providerId: "fixture" } }),
  { headers: { "content-type": "application/json" } });
}

function fixtureConfig(workspaceRoot: string, harness: BenchmarkConfig["harness"]): BenchmarkConfig {
  return { apiToken: "offline-fixture", apiUrl: "https://offline.invalid", harness, instruction: "Inspect this workspace.",
    maxIterations: 64, modelId: "fixture", providerId: "fixture", taskId: "silent-model",
    reasoningEffort: "high", timeoutMs: 900_000, workspaceRoot };
}
