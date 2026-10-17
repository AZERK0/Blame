// Final registration is deliberately refused until the preceding panel is audited.
import assert from 'node:assert/strict';
import {cp,mkdir,readFile,writeFile,symlink,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';
import {repo,work,study,dependencyRoot,sha,json,save} from './setup.mjs';
const parentStudy=join(repo,'docs/experiments/light-harness-path-recovery-f43-2026-10-17');
const parent=await json(join(parentStudy,'summary.json'));assert.equal(parent.complete,true);
const controls=await json(join(study,'oracle-controls.json'));assert.equal(controls.complete,true);assert.equal(controls.rows.length,3);
assert.ok(controls.rows.every(r=>r.after.every(c=>c.exitCode===0)));
assert.equal(controls.setupSha256,sha(await readFile(join(import.meta.dirname,'setup.mjs'))),'Controls must cover the final input preparation');
const predecessor=await json(join(repo,'docs/experiments/light-harness-confirmation-f42-2026-10-17/protocol.json'));
const {tasks}=await import('./tasks.mjs');
const sourceHead=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const sourceStatus=execFileSync('git',['status','--porcelain','--','packages/agent-runtime','packages/benchmark-runner'],{cwd:repo,encoding:'utf8'});
assert.equal(sourceStatus,'','Commit the tested implementation before registration');
await mkdir(work,{recursive:true});await symlink(dependencyRoot,join(work,'dependencies'));
const changed=[];
for(const arm of ['reference','scope']){
 const root=join(work,'frozen',arm);await mkdir(root,{recursive:true});
 await cp(join(repo,'packages/agent-runtime/dist'),join(root,'agent-runtime/dist'),{recursive:true});
 await save(join(root,'agent-runtime/package.json'),{type:'module',exports:'./dist/index.js'});
 await symlink(join(repo,'packages/agent-runtime/node_modules'),join(root,'agent-runtime/node_modules'));
 // Same current source, prompts, schemas, compiler recognition and helper bytes;
 // only the call site enabling compiler file-scope feedback differs.
 if(arm==='reference'){const path=join(root,'agent-runtime/dist/harness/light-task-runner.js'),text=await readFile(path,'utf8'),call='const compilerCapture = await compilerScopeCapture(task, declaredInvocation, this.files);';assert.ok(text.includes(call));await writeFile(path,text.replace(call,'const compilerCapture = undefined;'));}
 await cp(join(repo,'packages/benchmark-runner/dist'),join(root,'benchmark-runner/dist'),{recursive:true});
 await save(join(root,'benchmark-runner/package.json'),{type:'module'});await mkdir(join(root,'benchmark-runner/node_modules/@blame'),{recursive:true});
 await symlink(join(root,'agent-runtime'),join(root,'benchmark-runner/node_modules/@blame/agent-runtime'));
}
for(const entry of await readdir(join(work,'frozen/scope'),{recursive:true,withFileTypes:true}))if(entry.isFile()){
 const path=relative(join(work,'frozen/scope'),join(entry.parentPath,entry.name));
 if(sha(await readFile(join(work,'frozen/scope',path)))!==sha(await readFile(join(work,'frozen/reference',path))))changed.push(path);
}
assert.deepEqual(changed,['agent-runtime/dist/harness/light-task-runner.js']);
await mkdir(join(study,'inputs'),{recursive:true});const artifacts={};
for(const arm of ['reference','scope']){
 const name='frozen-'+arm+'.tar.gz';
 execFileSync('tar',['-czf',join(study,'inputs',name),'--exclude=node_modules','-C',join(work,'frozen'),arm]);
 artifacts[name]=sha(await readFile(join(study,'inputs',name)));
}
for(const [source,name]of ['valibot','remeda'].map(p=>[join(repo,'docs/experiments/light-harness-confirmation-f42-2026-10-17/inputs',p+'.tar.gz'),p+'.tar.gz']).concat([[join(repo,'pnpm-lock.yaml'),'workspace-pnpm-lock.yaml']])){
 await cp(source,join(study,'inputs',name));artifacts[name]=sha(await readFile(join(study,'inputs',name)));
}
await save(join(study,'input-archives.json'),{artifacts,note:'Frozen executable bytes and prompt/assets; dependencies reconstructed from the workspace lock plus dependency-package-lock.json. Excluded node_modules links must be reattached to those installations. No reference solution is present in measured workspaces.'});
await save(join(study,'host-validation-overlap.json'),{fullRuntimeLogCreatedUTC:null,lastLogWriteUTC:null,note:'Runtime suite validation completed before F44 model workers. No suite overlap is planned; record any later deviation rather than discarding trials.'});
await save(join(study,'host-development-overlap.json'),{activities:[],caveat:'Sequential model workers on a nonexclusive host; light trace review can overlap. No other benchmark, compile or test workload is scheduled during F44 workers. Unknown external contention is not excluded.'});
await save(join(study,'isolation-controls.json'),{modelRequests:0,sourceHead,changedExecutableFiles:changed,baseline:'Current Light including the independently fixed invocation-only typecheck guard. Both trees contain the same scope helper; only its invocation in light-task-runner differs.',mechanism:'Only compiler file-membership instrumentation and its bounded feedback differ. No tool-schema/prompt change, automatic check expansion, extra command, source admission or completion gate.'});
for(const name of ['native-search-bindings.json'])await cp(join(parentStudy,name),join(study,name));
await save(join(study,'prompt-date-binding.json'),{fixedDate:'2026-10-17',originalHashes:[sha(await readFile(join(work,'frozen/scope/agent-runtime/dist/cline-runtime-prompts.js')))]});
const arms=['reference','scope','cline'],order=[];
for(let repeat=1;repeat<=3;repeat++)for(let t=0;t<tasks.length;t++)for(let a=0;a<3;a++)order.push({repeat,task:tasks[t].id,arm:arms[(a+t+repeat-1)%3]});
await cp(join(dependencyRoot,'package-lock.json'),join(study,'dependency-package-lock.json'));
await save(join(study,'prior-budget.json'),{observedUsd:parent.cumulativeObservedSdkUsd,reservedUsd:parent.cumulativeReservedUsd,accountedUsd:parent.cumulativeAccountedUsd,parent:relative(repo,parentStudy),parentSummarySha256:sha(await readFile(join(parentStudy,'summary.json')))});
await save(join(study,'protocol.json'),{phase:'F44',registeredAtUTC:new Date().toISOString(),readyForModel:true,sourceHead,provider:predecessor.provider,model:predecessor.model,effort:predecessor.effort,apiUrl:predecessor.apiUrl,projects:predecessor.projects,arms,repetitions:3,tasks,order,runtimeByArm:{reference:'reference',scope:'scope',cline:'reference'},knownDiagnostic:false,
 selection:'Three new constructed requests on previously studied Valibot/Remeda, selected in the published engineering plan before any F44 model results; three dependent repeats. Tasks explicitly require a new regression-test file, so this is a validation-focused cohort, not representative issue prevalence or a new-project confirmation. Known F42/F43 diagnostics guide the mechanism, not model-task selection after outcomes.',
 budgets:{...predecessor.budgets,panelObservedCostStopUsd:12},
 execution:{concurrency:1,dependencyLockSha256:sha(await readFile(join(dependencyRoot,'package-lock.json'))),npm:'11.6.4 via per-trial node_modules/.bin, restored after login profiles with the same hashed BASH_ENV prelude',cache:'Empty isolated offline npm cache per trial; update notifier disabled',dependencies:'Copied per trial; original package hashes and symlink targets verified after model exit. Generated caches recorded separately.',workspace:'Outside the host repository, with no ancestor node_modules',validation:'Four identical selected checks; two optional delivered-test runtime/type scripts used uniformly by the independent grader after each endpoint. Preserve original tests/configuration. New regression tests are required, and their runtime/type correctness is audited separately. Compiler file membership does not establish runtime coverage or full-project acceptance.',environmentChange:'Pinned dependencies, caches, checks, prompt and scope-name guard are common to F44 arms. Do not pool with F42/F43 or attribute cross-campaign differences to feedback.'},
 criteria:{minimumPairedSuccesses:6,primary:'Strict audited completion on all9 assigned trials per arm: supplied checks, unchanged original tests/configuration, compatible behavior, an added regression test that runs and compiles, fresh final-source validation, truthful reporting and no solution retrieval. Record official and selected success separately.',
 mechanism:'Count compiler membership reports, explicit changed-files-not-reported feedback and subsequent broader validation in later model iterations. Record earlier broad checks and distinguish possible exposure from observed follow-up; no latent reasoning or causal mediation inferred from correlation.',
 resources:'Compare paired strict successes, minimum6 pairs. Retain all failures/timeouts/missing usage and costs; report per-task and leave-pair/task-out sensitivity. Efficiency requires lower tokens and SDK cost with duration <=110% and no audited-quality decrease.',
 decision:'Keep the independently verified task-name scope guard. Retain the default feedback treatment only if no audited-quality decrease and observed follow-up accompany either more audited successes or the efficiency threshold; otherwise withdraw it from the default path and preserve its frozen prototype/results. No retries or optional stopping. Finite constructed trials cannot establish general superiority.'},
 boundScripts:['setup','run','freeze','controls','environment-smoke','tasks','feature','regression','types','delivered'].map(n=>'tools/terminal_bench/validation-scope-study/'+n+'.mjs')});
console.log(JSON.stringify({phase:'F44',assignments:order.length,changed,sourceHead}));
