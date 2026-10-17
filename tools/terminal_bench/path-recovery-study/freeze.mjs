// Final registration is deliberately refused until the preceding panel is audited.
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,symlink,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {repo,work,study,dependencyRoot,sha,json,save} from './setup.mjs';
const parentStudy=join(repo,'docs/experiments/light-harness-confirmation-f42-2026-10-17');
const parent=await json(join(parentStudy,'summary.json'));assert.equal(parent.complete,true);
const controls=await json(join(study,'oracle-controls.json'));assert.equal(controls.complete,true);assert.equal(controls.rows.length,3);
assert.ok(controls.rows.every(r=>r.after.every(c=>c.exitCode===0)));
const predecessor=await json(join(parentStudy,'protocol.json'));
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const sourceStatus=execFileSync('git',['status','--porcelain','--','packages/agent-runtime','packages/benchmark-runner'],{cwd:repo,encoding:'utf8'});
assert.equal(sourceStatus,'','Commit the tested implementation before registration');
await mkdir(work,{recursive:true});await symlink(dependencyRoot,join(work,'dependencies'));
const changed=[];
for(const arm of ['reference','recovery']){
 const root=join(work,'frozen',arm);await mkdir(root,{recursive:true});
 await cp(join(repo,'packages/agent-runtime/dist'),join(root,'agent-runtime/dist'),{recursive:true});
 await save(join(root,'agent-runtime/package.json'),{type:'module',exports:'./dist/index.js'});
 await symlink(join(repo,'packages/agent-runtime/node_modules'),join(root,'agent-runtime/node_modules'));
 // Same current source, prompts, schemas, compiler recognition and helper bytes;
 // only the call site enabling missing-path recovery differs.
 if(arm==='reference')await cp(join(repo,'.blame/research/confirmation-f42/frozen/compiler/agent-runtime/dist/harness/light-workspace.js'),join(root,'agent-runtime/dist/harness/light-workspace.js'));
 await cp(join(repo,'packages/benchmark-runner/dist'),join(root,'benchmark-runner/dist'),{recursive:true});
 await save(join(root,'benchmark-runner/package.json'),{type:'module'});await mkdir(join(root,'benchmark-runner/node_modules/@blame'),{recursive:true});
 await symlink(join(root,'agent-runtime'),join(root,'benchmark-runner/node_modules/@blame/agent-runtime'));
}
for(const entry of await readdir(join(work,'frozen/recovery'),{recursive:true,withFileTypes:true}))if(entry.isFile()){
 const path=relative(join(work,'frozen/recovery'),join(entry.parentPath,entry.name));
 if(sha(await readFile(join(work,'frozen/recovery',path)))!==sha(await readFile(join(work,'frozen/reference',path))))changed.push(path);
}
assert.deepEqual(changed,['agent-runtime/dist/harness/light-workspace.js']);
await mkdir(join(study,'inputs'),{recursive:true});const artifacts={};
for(const arm of ['reference','recovery']){
 const name='frozen-'+arm+'.tar.gz';
 execFileSync('tar',['-czf',join(study,'inputs',name),'--exclude=node_modules','-C',join(work,'frozen'),arm]);
 artifacts[name]=sha(await readFile(join(study,'inputs',name)));
}
for(const [source,name]of [[join(parentStudy,'inputs/valibot.tar.gz'),'valibot.tar.gz'],[join(repo,'pnpm-lock.yaml'),'workspace-pnpm-lock.yaml']]){
 await cp(source,join(study,'inputs',name));artifacts[name]=sha(await readFile(join(study,'inputs',name)));
}
await save(join(study,'input-archives.json'),{artifacts,note:'Frozen executable bytes and prompt/assets; dependencies reconstructed from the workspace lock plus dependency-package-lock.json. Excluded node_modules links must be reattached to those installations. No reference solution is present in measured workspaces.'});
await save(join(study,'host-validation-overlap.json'),{fullRuntimeLogCreatedUTC:null,lastLogWriteUTC:null,note:'Runtime suite validation completed before F43 model workers. No suite overlap is planned; record any later deviation rather than discarding trials.'});
await save(join(study,'host-development-overlap.json'),{activities:[],caveat:'Sequential model workers on a nonexclusive host; light trace review can overlap. No other benchmark, compile or test workload is scheduled during F43 workers. Unknown external contention is not excluded.'});
await save(join(study,'isolation-controls.json'),{modelRequests:0,sourceHead,changedExecutableFiles:changed,baseline:'Current compiler-enabled Light with the F42 light-workspace.js call site; the uncalled recovery helper is present in both snapshots.',mechanism:'Only missing literal path reads can return indexed exact-basename candidates. No prompt/schema change, automatic target choice or observation coverage.'});
for(const name of ['native-search-bindings.json'])await cp(join(parentStudy,name),join(study,name));
await save(join(study,'prompt-date-binding.json'),{fixedDate:'2026-10-17',originalHashes:[sha(await readFile(join(work,'frozen/recovery/agent-runtime/dist/cline-runtime-prompts.js')))]});
const common=' Work only in this checkout; do not retrieve history, solutions or research artifacts. Preserve supplied checks, existing test files, metadata, manifests, locks, configuration and dependencies. You may change implementation and add new test files, but do not edit existing test files. Inspect the public API and affected callers. After the final implementation edit run npm run test:study:regression, npm run test:study:feature, npm run test:study:types and npm run test:study:upstream. Report commands, outcomes and coverage limits accurately. The upstream script covers only the selected related original tests, not the whole project. Vitest and TypeScript are installed; npm uses an isolated offline cache. No additional package installation is needed or allowed.\n';
const tasks=predecessor.tasks.filter(t=>t.project==='valibot').map(t=>({...t,instruction:t.request+common,requiredChecks:[...t.requiredChecks,{id:'upstream',task:'test:study:upstream'}]}));
const arms=['reference','recovery','cline'],order=[];
for(let repeat=1;repeat<=2;repeat++)for(let t=0;t<tasks.length;t++)for(let a=0;a<3;a++)order.push({repeat,task:tasks[t].id,arm:arms[(a+t+repeat-1)%3]});
await cp(join(dependencyRoot,'package-lock.json'),join(study,'dependency-package-lock.json'));
await save(join(study,'prior-budget.json'),{observedUsd:parent.cumulativeObservedSdkUsd,reservedUsd:parent.cumulativeReservedUsd,accountedUsd:parent.cumulativeAccountedUsd,parent:relative(repo,parentStudy),parentSummarySha256:sha(await readFile(join(parentStudy,'summary.json')))});
await save(join(study,'protocol.json'),{phase:'F43',registeredAtUTC:new Date().toISOString(),readyForModel:true,sourceHead,provider:predecessor.provider,model:predecessor.model,effort:predecessor.effort,apiUrl:predecessor.apiUrl,projects:predecessor.projects.filter(p=>p.name==='valibot'),arms,repetitions:2,tasks,order,runtimeByArm:{reference:'reference',recovery:'recovery',cline:'reference'},knownDiagnostic:true,
 selection:'All three previously selected Valibot requests, two repetitions each. These are known diagnostic tasks, not fresh confirmation. Exploratory engineering began after the first ten F42 trials; final registration follows the complete F42 audit.',
 budgets:{...predecessor.budgets,panelObservedCostStopUsd:12},
 execution:{concurrency:1,dependencyLockSha256:sha(await readFile(join(dependencyRoot,'package-lock.json'))),npm:'11.6.4 via per-trial node_modules/.bin, restored after login profiles with the same hashed BASH_ENV prelude',cache:'Empty isolated offline npm cache per trial; update notifier disabled',dependencies:'Copied per trial; original package hashes and symlink targets verified after model exit. Generated caches recorded separately.',workspace:'Outside the host repository, with no ancestor node_modules',validation:'Original selected checks plus related upstream runtime assertions; selected production compiler scope. These do not establish full project or user-criteria verification.',environmentChange:'Pinned Vitest/npm, extra related upstream checks and explicit existing-test preservation are common to all F43 arms. Do not compare F42 vs F43 as an isolated source-code effect.'},
 criteria:{minimumPairedSuccesses:4,primary:'No audited completion decrease vs reference, using unchanged original checks, compatible public behavior, actual final-source validation, delivered added-test correctness and no solution retrieval.',mechanism:'Count recoveries offered, explicit suggested reads accepted, remaining missing reads, edit guards and extra response bytes. Unused recovery cannot explain an observed aggregate difference.',resources:'Report all assignments including failures/timeouts/missing receipts; compare paired audited successes. Exploratory retention threshold: at least four paired successes, lower total tokens and SDK cost, duration <=110%, no quality decrease and at least one actual use. Report per-task/pair leave-out sensitivity; this panel cannot prove broad superiority.',decision:'Retain as an efficiency improvement only if mechanism and quality/resource criteria hold; otherwise keep as local diagnostic only or abandon based on adverse effects. No optional stopping or trial retries.'},
 boundScripts:['setup','run','freeze','controls','environment-smoke'].map(n=>'tools/terminal_bench/path-recovery-study/'+n+'.mjs').concat(['setup','feature','regression','types','tasks'].map(n=>'tools/terminal_bench/confirmation-study/'+n+'.mjs'))});
console.log(JSON.stringify({phase:'F43',assignments:order.length,changed,sourceHead}));
