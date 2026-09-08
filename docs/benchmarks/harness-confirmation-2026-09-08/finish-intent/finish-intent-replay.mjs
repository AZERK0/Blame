import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = resolve('packages/agent-runtime/dist/harness');
const { LightWorkspace } = await import(pathToFileURL(join(runtime, 'light-workspace.js')).href);
const { LightFinishService } = await import(pathToFileURL(resolve(process.argv[3] ?? join(runtime, 'light-finish-service.js'))).href);

async function prepare(root) {
  const scripts = { build: 'node unavailable-build.cjs', test: 'node verify.cjs' };
  await writeFile(join(root, 'package.json'), JSON.stringify({ scripts }));
  await writeFile(join(root, 'value.cjs'), 'module.exports = 1;\n');
  await writeFile(join(root, 'verify.cjs'), 'process.exit(require("./value.cjs") === 2 ? 0 : 1);\n');
  await writeFile(join(root, 'unavailable-build.cjs'), 'require("fs").writeFileSync(".blame/build-invoked", "yes"); process.exit(7);\n');
  const workspace = new LightWorkspace(root, { sessionId: 'finish-intent' });
  const edit = await workspace.editCode({ operations: [{ kind: 'patch', path: 'value.cjs',
    patch: '*** Begin Patch\n*** Update File: value.cjs\n@@\n-module.exports = 1;\n+module.exports = 2;\n*** End Patch' }] });
  if (edit.status !== 'ok') throw new Error('Fixture edit failed');
  return workspace;
}

async function inspect(root, workspace, validation) {
  const activities = [];
  const notifications = [];
  if (validation) await workspace.runTask({ kind: 'project', task: validation }, {});
  const finish = new LightFinishService({ workspaceRoot: root, conversationId: 'finish-intent',
    onComplete: (notification) => notifications.push(notification),
    onValidationActivity: (activity) => activities.push({ phase: activity.phase, task: activity.input.task }) });
  let accepted = false;
  let error;
  try { await finish.finish('Updated the value.', {}); accepted = true; }
  catch (failure) { error = failure.message.split('\n')[0]; }
  const buildInvoked = await readFile(join(root, '.blame/build-invoked')).then(() => true, () => false);
  return { validation, accepted, error, buildInvoked, activities,
    verified: notifications.at(-1)?.verified ?? null };
}

const records = [];
for (const validation of [null, 'test', 'build']) {
  const root = await mkdtemp(join(tmpdir(), 'blame-finish-intent-'));
  try { records.push(await inspect(root, await prepare(root), validation)); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const destination = process.argv[2];
if (destination) await writeFile(destination, JSON.stringify(records, null, 2) + '\n');
process.stdout.write(JSON.stringify(records) + '\n');
