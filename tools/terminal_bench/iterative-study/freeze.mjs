import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, work, study, sha, json, save, prepare } from './setup.mjs';

const controls = await json(join(study, 'oracle-controls.json'));
assert.ok(controls.every(row => row.before[0].exitCode === 1 && row.before[1].exitCode !== 0 && row.before[2].exitCode === 0 && row.after.every(check => check.exitCode === 0)));
const previous = join(repo, 'docs/experiments/light-harness-dependency-declarations-f37-2026-10-16');
for (const arm of ['reference', 'declarations']) {
  const root = join(work, 'frozen', arm); await mkdir(root, { recursive: true });
  const runtime = join(root, 'agent-runtime/dist'); await mkdir(runtime, { recursive: true });
  execFileSync('tar', ['-xzf', join(previous, 'reference-runtime.tar.gz'), '--strip-components=1', '-C', runtime]);
  if (arm === 'declarations') execFileSync('tar', ['-xzf', join(previous, 'candidate-overlay.tar.gz'), '--strip-components=1', '-C', runtime]);
  const manifest = await json(join(previous, 'reference-runtime.json'));
  const overlay = await json(join(previous, 'candidate-runtime.json'));
  const expected = arm === 'reference' ? manifest.files : { ...manifest.files, ...overlay.files };
  for (const [path, hash] of Object.entries(expected)) assert.equal(sha(await readFile(join(runtime, path))), hash, path);
  await save(join(root, 'agent-runtime/package.json'), { type: 'module', exports: './dist/index.js' });
  await symlink(join(repo, 'packages/agent-runtime/node_modules'), join(root, 'agent-runtime/node_modules'));
  await cp(join(repo, 'packages/benchmark-runner/dist'), join(root, 'benchmark-runner/dist'), { recursive: true });
  await save(join(root, 'benchmark-runner/package.json'), { type: 'module' });
  await mkdir(join(root, 'benchmark-runner/node_modules/@blame'), { recursive: true });
  await symlink(join(root, 'agent-runtime'), join(root, 'benchmark-runner/node_modules/@blame/agent-runtime'));
}
const diagnostic = join(work, 'declaration-preflight'); await prepare(diagnostic, 'form-length');
const observations = [];
for (const arm of ['reference', 'declarations']) {
  const { LightWorkspace } = await import(pathToFileURL(join(work, 'frozen', arm, 'agent-runtime/dist/harness/light-workspace.js')).href);
  const workspace = new LightWorkspace(diagnostic, { sessionId: `preflight-${arm}` });
  const result = await workspace.readCode({ target: 'lib/platform/node/classes/FormData.js#FormData.getLength', view: 'declaration' }, {});
  observations.push({ arm, result });
}
await save(join(study, 'declaration-preflight.json'), observations);
assert.equal(observations[0].result.status, 'blocked');
assert.equal(observations[1].result.status, 'ok', JSON.stringify(observations[1]));
const F36 = await json(join(repo, 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16/summary.json'));
await save(join(study, 'prior-budget.json'), { parent: 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16/summary.json',
  parentSha256: sha(await readFile(join(repo, 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16/summary.json'))),
  observedUsd: F36.priorObservedUsd + F36.accounting.observedUsd,
  reservedUsd: F36.priorReservedUsd + F36.accounting.reservedUsd,
  accountedUsd: F36.totalAccountedUsd });
await cp(join(repo, 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16/native-search-bindings.json'), join(study, 'native-search-bindings.json'));
await save(join(study, 'prompt-date-binding.json'), { fixedDate: '2026-10-16', originalHashes: [sha(await readFile(join(work, 'frozen/reference/agent-runtime/dist/cline-runtime-prompts.js')))] });
const common = ' Work independently from this checkout. Do not retrieve remote history, reference solutions, earlier benchmark artifacts or research controls. Preserve supplied checks, metadata, dependencies, manifests, lockfiles and configuration; implementation files and your own new tests may change. Inspect the relevant implementation and public API. Both ESM and CommonJS public types must reflect the change. After the final implementation edit, run npm run test:study:regression, npm run test:study:feature, and npm run test:study:types. Equivalent invocations of these same supplied scripts are accepted; report the actual commands and outcomes, disclose limitations, and leave unknown counts unknown. The supplied Node tests cover selected behaviors, not the full upstream browser/package suite.\n';
const tasks = [
  { id: 'clear-count', instruction: 'Change Axios interceptor managers so clear() returns the number of live handlers removed. Ejected holes do not count; clearing an empty or already cleared manager returns0. Preserve use/eject/iteration and existing request/response order, instance independence and backward-compatible clearing side effects. Update public types and demonstrate the behavior.' + common },
  { id: 'form-length', instruction: 'Add opt-in Axios request config requireFormDataLength?: boolean for legacy form-data bodies in the Node HTTP adapter. When true, call the dependency asynchronous length API before sending, even if Content-Length was supplied. A callback error or non-number, non-finite or negative length must reject with an Axios error and must not invoke transport. Valid zero and positive lengths are accepted; preserve caller Content-Length when supplied, otherwise set the discovered length. Default/false and native/spec FormData behavior remain unchanged. Cancellation while length is pending must reject without sending; preserve maxBodyLength configuration. Update public types and demonstrate the behavior.' + common },
];
for (const task of tasks) task.requiredChecks = ['regression', 'feature', 'types'].map(name => ({ id: name, task: `test:study:${name}` }));
const arms = ['reference', 'declarations', 'cline'], order = [];
for (let repeat = 1; repeat <= 2; repeat++) for (const [taskIndex, task] of tasks.entries())
  for (let index = 0; index < arms.length; index++) order.push({ repeat, task: task.id, arm: arms[(index + repeat - 1 + taskIndex) % arms.length] });
const sourceFiles = (await readdir(join(work, 'upstream/axios-1.12.2/lib'), { recursive: true, withFileTypes: true })).filter(entry => entry.isFile() && entry.name.endsWith('.js')).length;
const protocol = { phase: 'F38', registeredAtUTC: new Date().toISOString(), readyForModel: true,
  project: { name: 'axios', tag: 'v1.12.2', commit: '4150efd104826d7af27d014378bf874964aa26ff', sourceFiles,
    sourceArchiveSha256: sha(await readFile(join(work, 'upstream/axios.tar.gz'))), dependencyLockSha256: sha(await readFile(join(work, 'dependencies/package-lock.json'))), researchJsconfigAdded: true },
  provider: process.env.BLAME_PROVIDER_ID, model: process.env.BLAME_MODEL_ID, effort: process.env.BLAME_REASONING_EFFORT,
  apiUrl: process.env.BLAME_API_URL, arms, repetitions: 2, order, tasks,
  runtimeByArm: { reference: 'reference', declarations: 'declarations', cline: 'reference' },
  baselineSourceCommit: '8ceb9139', candidateSourceCommit: '464f2e04', nativeSearchRepair: true,
  budgets: { perTrialSdkCostLimitUsd: 0.10, requestOvershootReserveUsd: 0.23, panelObservedCostStopUsd: 4,
    sharedStudyObservedCostStopUsd: 10.951612, maxIterations: 32, timeoutSeconds: 600, outerWatchdogExtraSeconds: 25,
    maximumSerializedRequestBytes: 290000, requestMaxOutputTokens: 8192 },
  criteria: { primary: 'Audited full user request, with faithful final-source check reporting and no solution retrieval.',
    qualityGate: 'Declaration Light audited count >= reference Light, all assigned outcomes retained.',
    resourceGate: 'At equal audited counts with at least two paired successes: paired total tokens and SDK cost decrease, paired duration <=110% of reference.',
    inference: 'Descriptive two purposively selected feature tasks, with dependent repeats; no population claim.' } };
await save(join(study, 'protocol.json'), protocol);
console.log(JSON.stringify({ sourceFiles, assignments: order.length, preflight: observations.map(row => ({ arm: row.arm, status: row.result.status })) }));
