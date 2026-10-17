import assert from 'node:assert/strict';import {cp,mkdir,readFile,writeFile,symlink,readdir} from 'node:fs/promises';import {join,relative} from 'node:path';import {pathToFileURL} from 'node:url';import {execFileSync} from 'node:child_process';
import {repo,work,study,sha,json,save,prepare} from './setup.mjs';import {tasks} from './tasks.mjs';
const controls=await json(join(study,'oracle-controls.json'));
assert.equal(controls.length,6);assert.ok(controls.every(r=>r.before[0].exitCode===0&&r.before[1].exitCode===1&&r.after.every(x=>x.exitCode===0)));
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const sourceBase=execFileSync('git',['log','-1','--format=%H','--','packages/agent-runtime/src','packages/benchmark-runner/src'],{cwd:repo,encoding:'utf8'}).trim();
const smoke=[],changed=[];
for(const arm of ['reference','compiler']){
 const root=join(work,'frozen',arm);await mkdir(root,{recursive:true});
 await cp(join(repo,'packages/agent-runtime/dist'),join(root,'agent-runtime/dist'),{recursive:true});
 await save(join(root,'agent-runtime/package.json'),{type:'module',exports:'./dist/index.js'});
 await symlink(join(repo,'packages/agent-runtime/node_modules'),join(root,'agent-runtime/node_modules'));
 if(arm==='reference'){
  const file=join(root,'agent-runtime/dist/harness/task-catalog.js');const source=await readFile(file,'utf8');const needle='const compilerOnly = inferredKind !== "service" && plainCompilerCheck(command);';assert.equal(source.split(needle).length,2);
  const altered=source.replace(needle,'const compilerOnly = false; // Registered research ablation of F41 classification.');
  await writeFile(file,altered);await save(join(study,'ablation.json'),{file:'harness/task-catalog.js',beforeSha256:sha(source),afterSha256:sha(altered),needle,replacement:'const compilerOnly = false; // Registered research ablation of F41 classification.',meaning:'Only recognition of literal compiler invocations is disabled. All other current code, scopes and journals remain common; this is not a historical release comparison.'});
 }
 await cp(join(repo,'packages/benchmark-runner/dist'),join(root,'benchmark-runner/dist'),{recursive:true});
 await save(join(root,'benchmark-runner/package.json'),{type:'module'});await mkdir(join(root,'benchmark-runner/node_modules/@blame'),{recursive:true});await symlink(join(root,'agent-runtime'),join(root,'benchmark-runner/node_modules/@blame/agent-runtime'));
 const fixture=join(work,'preflight',arm);await prepare(fixture,tasks[0].id);
 const {buildDevelopmentSystemPrompt}=await import(pathToFileURL(join(root,'agent-runtime/dist/cline-runtime-prompts.js')));
 const prompt=await buildDevelopmentSystemPrompt({cwd:fixture,workspaceRoot:fixture});assert.ok(prompt.length>1000);
 const {readTaskCatalog}=await import(pathToFileURL(join(root,'agent-runtime/dist/harness/task-catalog.js')));
 const task=(await readTaskCatalog(fixture)).find(t=>t.task_id==='test:study:types');assert.equal(task.kind,arm==='compiler'?'typecheck':'test');if(arm==='compiler')assert.equal(task.validationScope,'invocation_only');
 smoke.push({arm,promptBytes:Buffer.byteLength(prompt),compilerTask:task});
}
const all=(await readdir(join(work,'frozen/compiler'),{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>relative(join(work,'frozen/compiler'),join(e.parentPath,e.name)));
for(const file of all){if(sha(await readFile(join(work,'frozen/compiler',file)))!==sha(await readFile(join(work,'frozen/reference',file))))changed.push(file);}
assert.deepEqual(changed,['agent-runtime/dist/harness/task-catalog.js']);
await save(join(study,'isolation-controls.json'),{modelRequests:0,sourceBase,head,changedExecutableFiles:changed,common:'Current main including F39/F40 and subsequent module refactors; only compiler recognition is ablated in reference.'});
await save(join(study,'asset-smoke.json'),{modelRequests:0,rows:smoke});
await cp(join(repo,'docs/experiments/light-harness-compiler-check-model-f41-2026-10-16/native-search-bindings.json'),join(study,'native-search-bindings.json'));
await save(join(study,'prompt-date-binding.json'),{fixedDate:'2026-10-17',originalHashes:[sha(await readFile(join(work,'frozen/compiler/agent-runtime/dist/cline-runtime-prompts.js')))]});
const arms=['reference','compiler','cline'],order=[];
for(let repeat=1;repeat<=3;repeat++)for(let t=0;t<tasks.length;t++)for(let a=0;a<3;a++)order.push({repeat,task:tasks[t].id,arm:arms[(a+t+repeat-1)%3]});
const priorPath=join(repo,'docs/experiments/light-harness-compiler-check-model-f41-2026-10-16');
const prior=await json(join(priorPath,'prior-budget.json'));const recent=await json(join(priorPath,'accounting.json')).catch(()=>json(join(priorPath,'model-accounting.json')));
await save(join(study,'prior-budget.json'),{observedUsd:prior.observedUsd+recent.observedUsd,reservedUsd:prior.reservedUsd+recent.reservedUsd,accountedUsd:prior.accountedUsd+recent.accountedUsd,parent:relative(repo,priorPath),parentAccountingSha256:sha(JSON.stringify(recent))});
const protocol={phase:'F42',registeredAtUTC:new Date().toISOString(),readyForModel:true,projects:(await json(join(study,'selection.json'))).projects,sourceBase,provider:'openai-codex',model:'gpt-5.6-luna',effort:'high',apiUrl:'https://api.blame.so/api/v1',arms,repetitions:3,tasks,order,runtimeByArm:{reference:'reference',compiler:'compiler',cline:'compiler'},nativeSearchRepair:true,knownDiagnostic:false,selection:'See committed selection.json. Fresh constructed tasks on previously unmeasured projects; not a representative real-issue sample.',budgets:{perTrialSdkCostLimitUsd:0.25,requestOvershootReserveUsd:0.23,panelObservedCostStopUsd:30,sharedStudyObservedCostStopUsd:100,maxIterations:48,timeoutSeconds:900,outerWatchdogExtraSeconds:25,maximumSerializedRequestBytes:500000,requestMaxOutputTokens:8192},execution:{concurrency:1,hostProcessReuse:false,fixedInputCommitAtUTC:'2026-10-17T00:00:00Z',dependencyInstallOutsideMeasuredWorker:true,compilers:'All selected production TS modules, excluding upstream test helpers/tests. This does not itself grant source-verification admission.',suite:'Selected supplied checks; full upstream suites not installed.'},criteria:{primary:'Audited task acceptance first: original protected checks and independent endpoint must pass, delivery must truthfully report attempted validation. Count official success, independent functional success, audited completion and check admission separately.',mechanism:'Passing compiler invocation admits required types in compiler arm; invocation_only cannot prove user criteria or file coverage. Count repeats, warnings, missing obligations.',resources:'Report all-assignment tokens/cache/SDK estimates/duration including failed attempts and missing data. Gate: no audited success decrease vs reference; at least 12 matched successes; token and cost sums lower and duration <=110% on paired successes. Report task-level and leave-one-task-out sensitivity. No population-superiority claim from six constructed tasks.',followup:'Choose one observed harness friction after F42; register an isolated diagnosis/repair phase with negative controls before new model outcomes.'}};
await save(join(study,'protocol.json'),protocol);await save(join(study,'budget-preflight.json'),{modelRequests:0,assignments:54,maximumAssignmentReservationsUsd:54*0.48,panelCeilingUsd:30,sharedCeilingUsd:100,priorAccountedUsd:prior.accountedUsd+recent.accountedUsd});
console.log(JSON.stringify({changed,assignments:order.length,smoke:smoke.map(x=>({arm:x.arm,kind:x.compilerTask.kind}))}));
