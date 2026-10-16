// Administrative capture only: never re-dispatch a model or repair task source.
import assert from 'node:assert/strict';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, work, study } from './paths.mjs';
const name = process.argv[4];
assert.equal(process.argv[2], 'recover');
assert.equal(process.argv[3], 'f34');
const protocol = JSON.parse(await readFile(join(study, 'protocol.json')));
const trial = protocol.order.find(t => [t.repetition, t.id, t.arm].join('-') === name);
assert.ok(trial);
const directory = join(work, 'f34', name);
await access(join(directory, 'trial.json')).then(() => { throw Error('Trial already captured'); }, e => { if (e.code !== 'ENOENT') throw e; });
const child = JSON.parse(await readFile(join(directory, 'model-child.json')));
const status = await readFile('/proc/' + child.pid + '/status', 'utf8').catch(e => { if (e.code === 'ENOENT') return '<absent>'; throw e; });
assert.ok(status === '<absent>' || /^State:\s+Z\b/m.test(status), 'Model process is still live');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const path = join(repo, 'tools/terminal_bench/invocation-model-study/run.mjs');
const driver = await readFile(path, 'utf8');
const binding = JSON.parse(await readFile(join(study, 'execution-bindings.json')));
assert.equal(sha(driver), binding.inputs['tools/terminal_bench/invocation-model-study/run.mjs']);
const before = {};
const task = protocol.tasks.find(t => t.id === trial.id);
for (const file of task.allowedPaths) before[file] = sha(await readFile(join(directory, 'workspace', file)));
// Invoke the frozen driver's existing checker/analyzer by an in-memory module.
// Its executable file and registered hash remain unchanged. Resolve imports to
// original absolute module URLs before removing only the CLI dispatch block.
let source = driver.slice(0, driver.indexOf('if (process.argv[2] === "prepare")'));
source = source.replace(/from (["'])(\.[^"']+)\1/g, (_all, _quote, relative) => 'from ' + JSON.stringify(new URL(relative, pathToFileURL(path)).href));
source += `\nconst capturedName=${JSON.stringify(name)},capturedTrial=${JSON.stringify(trial)};
const capturedDirectory=join(campaign,capturedName),capturedWorkspace=join(capturedDirectory,'workspace');
const verificationStarted=performance.now();
await score(capturedDirectory,capturedWorkspace,protocol.tasks.find(t=>t.id===capturedTrial.id));
await writeFile(join(capturedDirectory,'workspace.diff'),git(['diff','--binary','HEAD'],capturedWorkspace));
await writeJson(join(capturedDirectory,'trial.json'),{...capturedTrial,name:capturedName,
 exit:{code:null,signal:null,watchdog:false,orchestrationInterrupted:true,stderr:'Execution transport disconnected; actual exit status unknown. Model not retried.'},
 preparationMs:null,bindingsVerificationMs:null,outerAgentMs:null,verificationMs:performance.now()-verificationStarted});
await analyze();\n`;
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
for (const [file, hash] of Object.entries(before)) assert.equal(sha(await readFile(join(directory, 'workspace', file))), hash, 'Checker changed implementation');
await writeFile(join(directory, 'orchestration-interruption.json'), JSON.stringify({
  capturedAtUTC: new Date().toISOString(), modelProcessPid: child.pid, processWasZombieOrAbsent: true,
  actualExitStatus: null, actualStopTime: null, sourceBeforeAndAfterGrading: before,
  originalDriverSha256: sha(driver), modelRetried: false,
  reason: 'exec-server transport closed and unified session recovery timed out; parent runner and model child terminated. Preserve this preassigned slot and resume only unexecuted suffix.'
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ name, modelRetried: false, actualExitStatus: null, implementationUnchangedByGrading: true }));
