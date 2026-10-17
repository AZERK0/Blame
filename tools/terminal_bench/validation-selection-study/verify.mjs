import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,json,sha} from '../validation-scope-study/setup.mjs';
const folder=join(repo,'docs/experiments/light-harness-selection-recovery-f45-2026-10-17');
const baseline=await json(join(folder,'baseline-replay.json')),candidate=await json(join(folder,'candidate-replay.json')),controls=await json(join(folder,'vitest-controls.json'));
assert.deepEqual(baseline.sourceHashes,candidate.sourceHashes);assert.equal(baseline.traceSha256,candidate.traceSha256);
for(const r of [baseline,candidate]){
 assert.equal(r.modelRequests,0);assert.equal(r.semanticWitness.exitCode,1);
 assert.equal(r.bad.data.exitCode,1);assert.equal(r.bad.data.check.outcome,'failed');
 assert.equal(r.broad.data.exitCode,0);assert.ok(r.broad.data.check.counts.executed>3800);
 assert.ok(r.checks.every(c=>c.data.exitCode===0));
 const retained=r.journal.validations.find(v=>v.args?.includes('packages/remeda/src/take.counts.test.ts'));
 assert.equal(retained.terminal,'failed');assert.equal(retained.status,'failed');
 assert.deepEqual(r.attempts.map(a=>a.requireBad),[false,true]);
}
assert.equal(baseline.bad.data.failure.category,'code');assert.equal(candidate.bad.data.failure.category,'command');
assert.equal(candidate.bad.data.check.selectionFailure,'no_test_files');assert.equal(candidate.bad.data.check.counts,undefined);
assert.match(candidate.bad.data.failure.recovery,/from packages\/remeda\./);
for(const a of baseline.attempts){assert.equal(a.errors.length,2);assert.ok(a.errors.every(e=>/still failing/.test(e)));assert.deepEqual(a.notifications,[]);}
for(const a of candidate.attempts){
 assert.deepEqual(a.errors,[]);assert.deepEqual(a.activities,[]);assert.equal(a.notifications.length,2);
 for(const n of a.notifications){assert.equal(n.verified,false);assert.equal(n.completion.verification,'unverified');
  assert.deepEqual(n.completion.missing_obligations,a.requireBad?['check:exact-selection']:[]);
  assert.deepEqual(n.completion.satisfied_obligations,['regression','feature','types','upstream'].map(x=>'check:'+x));}
}
assert.equal(controls.failure.data.failure.category,'code');assert.equal(controls.failure.data.check.counts.failed,1);
assert.equal(controls.passing.data.check.outcome,'passed');assert.match(controls.finishError,/still failing/);
assert.equal(controls.typeGap.vitest.exitCode,0);assert.equal(controls.typeGap.compiler.exitCode,2);
assert.match(controls.typeGap.vitest.stdout,/Type Errors\s+no errors/);assert.match(controls.typeGap.compiler.stdout,/TS2322/);
const artifacts={};for(const name of ['baseline-replay.json','candidate-replay.json','vitest-controls.json'])artifacts[name]=sha(await readFile(join(folder,name)));
const bindings=await json(join(repo,'docs/experiments/light-harness-validation-scope-f44-2026-10-17/execution-bindings.json'));
const frozen=Object.entries(bindings.files).find(([path])=>path.endsWith('/frozen'))[1];
const runtimeHashes={baseline:{},candidate:candidate.runtimeHashes};
for(const file of Object.keys(candidate.runtimeHashes))runtimeHashes.baseline[file]=frozen['reference/agent-runtime/dist/harness/'+file];
assert.deepEqual(candidate.runtimeHashes,controls.runtimeHashes);
// Research-script-only commits may differ; executed runtime bytes must match.
const result={modelRequests:0,complete:true,artifacts,runtimeHashes,retainedFailedInvocation:true,requiredSelectionNotSatisfied:true,realAssertionStillBlocks:true,sourceUnchangedAndStillIncorrect:true,classificationCorrected:true,automaticRetries:0,scope:'Local mechanism confirmation only; no post-fix model success, duration or token claim.'};
await writeFile(join(folder,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
