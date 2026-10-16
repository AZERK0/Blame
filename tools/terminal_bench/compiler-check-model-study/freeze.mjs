import assert from 'node:assert/strict';
import { cp, mkdir, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, work, study, json, save, prepare, sha } from './setup.mjs';
const parentStudy = join(repo, 'docs/experiments/light-harness-iterative-f38-2026-10-16');
const parentWork = join(repo, '.blame/research/iterative-f38');
const parent = await json(join(parentStudy, 'protocol.json'));
const exit = await json(join(parentWork, 'campaign/driver-exit.json'));
assert.equal(exit.complete, true); assert.equal(exit.completed, 12);
const prior = await json(join(parentStudy, 'prior-budget.json'));
const accounting = await json(join(parentWork, 'campaign/accounting.json'));
await save(join(study, 'prior-budget.json'), { parent: 'docs/experiments/light-harness-iterative-f38-2026-10-16/corrected-accounting.json',
  parentSha256: sha(await readFile(join(parentWork, 'campaign/accounting.json'))), previous: prior,
  observedUsd: prior.observedUsd + accounting.observedUsd, reservedUsd: prior.reservedUsd + accounting.reservedUsd,
  accountedUsd: prior.accountedUsd + accounting.accountedUsd });
await cp(join(parentWork, 'campaign/accounting.json'), join(parentStudy, 'corrected-accounting.json'));
await cp(join(parentWork, 'campaign/driver-exit.json'), join(parentStudy, 'corrected-driver-exit.json'));
const changed = ['harness/task-catalog.js', 'harness/light-task-runner.js', 'harness/session-journal.js', 'harness/light-validation-report.js'];
const modules = {}, smoke = [];
for (const arm of ['reference', 'compiler']) {
  const root = join(work, 'frozen', arm); await mkdir(root, { recursive: true });
  await cp(join(parentWork, 'frozen/declarations/agent-runtime/dist'), join(root, 'agent-runtime/dist'), { recursive: true });
  if (arm === 'compiler') for (const path of changed)
    await cp(join(repo, 'packages/agent-runtime/dist', path), join(root, 'agent-runtime/dist', path));
  await save(join(root, 'agent-runtime/package.json'), { type: 'module', exports: './dist/index.js' });
  await symlink(join(repo, 'packages/agent-runtime/node_modules'), join(root, 'agent-runtime/node_modules'));
  await cp(join(parentWork, 'frozen/declarations/benchmark-runner/dist'), join(root, 'benchmark-runner/dist'), { recursive: true });
  await save(join(root, 'benchmark-runner/package.json'), { type: 'module' });
  await mkdir(join(root, 'benchmark-runner/node_modules/@blame'), { recursive: true });
  await symlink(join(root, 'agent-runtime'), join(root, 'benchmark-runner/node_modules/@blame/agent-runtime'));
  modules[arm] = Object.fromEntries(await Promise.all(changed.map(async path => [path, sha(await readFile(join(root, 'agent-runtime/dist', path)))])));
  const fixture = join(work, 'preflight', arm); await prepare(fixture, 'clear-count');
  const prompts = await import(pathToFileURL(join(root, 'agent-runtime/dist/cline-runtime-prompts.js')).href);
  const text = await prompts.buildDevelopmentSystemPrompt({ cwd: fixture, workspaceRoot: fixture });
  assert.ok(text.length > 1000);
  const { readTaskCatalog } = await import(pathToFileURL(join(root, 'agent-runtime/dist/harness/task-catalog.js')).href);
  const task = (await readTaskCatalog(fixture)).find(item => item.task_id === 'test:study:types');
  assert.equal(task.kind, arm === 'reference' ? 'test' : 'typecheck');
  if (arm === 'compiler') assert.equal(task.validationScope, 'invocation_only');
  smoke.push({ arm, promptBytes: Buffer.byteLength(text), taskKind: task.kind, validationScope: task.validationScope ?? null });
}
assert.ok(changed.every(path => modules.reference[path] !== modules.compiler[path]));
await save(join(study, 'isolation-controls.json'), { modelRequests: 0, changedExecutableModules: changed, modules,
  common: 'F38b declaration-enabled runtime with full prompt/plugin assets and its unchanged old benchmark runner. No F39 scoped-patch diagnostic or F40 runner counter change is bundled.',
  treatment: 'Only F41 compiler classification, required invocation admission and conservative invocation-only scope propagation.',
  candidateSourceCommit: 'b3aa4571', referenceSourceCommit: '464f2e04' });
await save(join(study, 'asset-smoke.json'), { modelRequests: 0, rows: smoke });
for (const name of ['native-search-bindings.json', 'prompt-date-binding.json', 'oracle-controls.json'])
  await cp(join(parentStudy, name), join(study, name));
const arms = ['reference', 'compiler', 'cline'], order = [];
for (let repeat = 1; repeat <= 3; repeat++) for (let index = 0; index < 3; index++)
  order.push({ repeat, task: 'clear-count', arm: arms[(index + repeat - 1) % 3] });
const protocol = { ...parent, phase: 'F41', registeredAtUTC: new Date().toISOString(),
  administrativeCorrection: undefined, knownDiagnostic: true, arms, repetitions: 3, tasks: parent.tasks.filter(task => task.id === 'clear-count'), order,
  runtimeByArm: { reference: 'reference', compiler: 'compiler', cline: 'reference' },
  budgets: { ...parent.budgets, panelObservedCostStopUsd: 3 },
  baselineSourceCommit: '464f2e04', candidateSourceCommit: 'b3aa4571',
  selection: 'Known F38b internal API task, chosen before F41 results because every Light trial had a successful compiler invocation but missing required compiler obligation. Same frozen user instructions/oracles; no source solution or prior agent messages are copied.',
  criteria: { primary: 'Audited task acceptance must not regress. Passing compiler invocations satisfy check:types; scope remains invocation_only and cannot alone verify excluded source.',
    mechanism: 'Count missing compiler obligations, compiler invocation repeats and compiler warnings separately from source verification.',
    resources: 'At equal audited quality with at least2 paired successes, compare summed tokens/cost and duration <=110%; report adverse results. Three dependent repeats on one known task do not establish general superiority.' } };
await save(join(study, 'protocol.json'), protocol);
await save(join(study, 'budget-preflight.json'), { modelRequests: 0, priorAccountedUsd: exit.cumulativeAccountedUsd,
  totalAssignmentReservationsUsd: 9 * 0.33, maximumCombinedReservationsUsd: exit.cumulativeAccountedUsd + 9 * 0.33,
  ceilingUsd: protocol.budgets.sharedStudyObservedCostStopUsd, admitted: exit.cumulativeAccountedUsd + 9 * 0.33 <= protocol.budgets.sharedStudyObservedCostStopUsd });
assert.ok(exit.cumulativeAccountedUsd + 9 * 0.33 <= protocol.budgets.sharedStudyObservedCostStopUsd);
console.log(JSON.stringify({ assignments: 9, smoke, priorAccountedUsd: exit.cumulativeAccountedUsd }));
