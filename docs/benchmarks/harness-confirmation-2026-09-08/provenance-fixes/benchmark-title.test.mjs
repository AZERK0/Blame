import assert from 'node:assert/strict';
import test from 'node:test';
import { runBenchmark } from '/mnt/dev/web/Blame/packages/benchmark-runner/dist/benchmark-run.js';

function runtime(events, inputs) {
  return {
    sessions: {
      startDevelopment: async input => {
        inputs.push(input);
        queueMicrotask(() => events.emit({ type: 'done', payload: { verified: false } }));
        return { sessionId: 'fixture-session' };
      },
      abort: async () => undefined,
      usage: async () => undefined,
    },
    shutdown: async () => undefined,
  };
}

function configuration(harness) {
  return {
    apiToken: 'unused', apiUrl: 'https://unused.invalid', harness,
    instruction: 'Repair the behavior described by this original issue.',
    maxIterations: 2, modelId: 'fixture', providerId: 'fixture',
    taskId: 'external-project__component-86420__trial', timeoutMs: 1000,
    workspaceRoot: '/workspace',
  };
}

for (const harness of ['blame', 'cline']) {
  test(`${harness} keeps dataset identifiers in results, outside model task text`, async () => {
    const config = configuration(harness);
    const inputs = [];
    const result = await runBenchmark(config, {
      createRecorder: () => ({ record() {}, close: async () => undefined,
        metrics: () => ({}), eventCount: 0, toolEventCount: 0 }),
      createRuntime: events => runtime(events, inputs),
    });
    assert.equal(result.status, 'succeeded');
    assert.equal(result.taskId, config.taskId);
    assert.equal(inputs[0].summary, config.instruction);
    assert.doesNotMatch(inputs[0].title, /external-project|component|86420|trial/);
  });
}
