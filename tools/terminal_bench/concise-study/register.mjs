// One finite panel. All tasks, controls and accounting frozen before dispatch.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {repo,study,work} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const parentRelative='docs/experiments/light-harness-phrase-ranking-f29-2026-10-15',parentRoot=join(repo,parentRelative);
const parent=await json(join(parentRoot,'protocol.json')),summary=await json(join(parentRoot,'guidance-summary.json')),replay=await json(join(parentRoot,'public-replay.json'));
assert.equal(summary.completed,18);assert.equal(summary.planned,18);assert.equal(replay.completed,18);
assert(Math.abs(summary.totalAccountedUsd-replay.totalAccountedUsd)<1e-10);
const documents={};for(const file of ['protocol.json','guidance-summary.json','shared-budget-accounting.json','public-replay.json','publication-controls.json','checks.json']){const b=await readFile(join(parentRoot,file));documents[file]={sha256:sha(b),utf8:b.toString('utf8')};}
const witness=gzipSync(JSON.stringify({documents}),{mtime:0});await writeFile(join(study,'parent-financial-witness.json.gz'),witness,{flag:'wx'});
const ledger={method:'Cumulative carry-forward only; no pooling of outcomes. Original F29 public financial witness retained.',parent:parentRelative,parentCompleted:18,
 observedUsd:JSON.parse(documents["shared-budget-accounting.json"].utf8).priorAccounting.reduce((n,e)=>n+e.accounting.observedUsd,0)+summary.accounting.observedUsd,
 reservedUsd:JSON.parse(documents["shared-budget-accounting.json"].utf8).priorAccounting.reduce((n,e)=>n+e.accounting.reservedUsd,0)+summary.accounting.reservedUsd,accountedUsd:summary.totalAccountedUsd,witness:{artifact:'parent-financial-witness.json.gz',sha256:sha(witness)},sourceDocuments:Object.fromEntries(Object.entries(documents).map(([n,d])=>[n,d.sha256]))};
assert(Math.abs(ledger.observedUsd+ledger.reservedUsd-ledger.accountedUsd)<1e-10);await writeFile(join(study,'prior-budget.json'),JSON.stringify(ledger,null,2)+'\n',{flag:'wx'});
const selection=await json(join(study,'task-selection.json')),arms=['baseline','candidate','cline'],order=[];
for(let repetition=1;repetition<=3;repetition++)for(const [index,task] of selection.tasks.entries())for(let offset=0;offset<3;offset++)order.push({repetition,id:task.id,arm:arms[(offset+index+repetition-1)%3]});
const upstream='.blame/research/concise-f30/upstreams/commander';
const protocol={studyKind:'concise-descriptions-multifile-confirmation',registeredAtUTC:new Date().toISOString(),readyForModel:false,
 taskSelectionAtUTC:selection.selectedAtUTC,taskInputCommitAtUTC:'2026-10-15T00:00:00.000Z',provider:parent.provider,model:parent.model,effort:parent.effort,apiUrl:parent.apiUrl,
 arms,lightArms:['baseline','candidate'],clineRuntimeArm:'baseline',repetitions:3,order,tasks:selection.tasks,
 upstreams:{commander:{sourceRoot:upstream,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:join(repo,upstream),encoding:'utf8'}).trim(),modules:['jest','typescript','tsd']}},
 nativeSearchRepair:true,captureWireContracts:true,
 budgets:{...parent.budgets,perTrialSdkCostLimitUsd:0.10,maxIterations:32,timeoutSeconds:600,panelObservedCostStopUsd:6},budgetAmendment:{...parent.budgetAmendment,
  note:'User authorized continuation without further budget questions. This finite phase voluntarily retains the previous cumulative EUR10 technical financial stop; no budget reset or unlimited process.'},
 priorBudget:'docs/experiments/light-harness-concise-f30-2026-10-15/prior-budget.json',
 driverInputs:['run.mjs','paths.mjs','register.mjs','freeze.mjs','features.mjs','tasks.mjs','fixtures.cjs','task-controls.mjs','positive.mjs','runtime-controls.mjs','prompt-date.mjs','prompt-date-controls.mjs','finalize.mjs'],
 environmentArtifacts:['tools/terminal_bench/guidance-study/paths.mjs',...['task-selection.json','candidate.patch','prior-budget.json','strengthened-evaluation-controls.json'].map(n=>'docs/experiments/light-harness-concise-f30-2026-10-15/'+n)],
 hypothesis:{mechanism:'Shorter five tool descriptions may reduce recurring context and unnecessary navigation while identical schemas,guards,receipts and system prompts preserve operational behavior.',
 comparison:'Current production including duplicate-header and qualified-name diagnostic fixes versus the same source with five description initializers shortened. Integrated ClineSDK0.0.82 uses the same pinned search repair. Ranking prototype absent.',
 measures:['official completion,frozen independent behavioral/type/suite success,actual final-source checks,full audited delivery','all-attempt observed resources including failures and missing usage','strict matched-success tokens,cache,estimated cost,worker/outer durations','description bytes,first-request schema bytes,read targets,blocked edits,repeated navigation'],
 risks:['less guidance can increase wrong tool selections','fewer prompt bytes need not lower billed tokens due to cache and trajectory changes','constructed tasks on one new project have limited external validity']},
 audit:'SHA-bound unblinded review of source,all effective tool inputs,post-final-edit commands,actual outputs and final report. Unknown counters are not zero. No reference retrieval or researcher source recovery. Passing tests,admitted verification and satisfaction of user criteria remain distinct. Preregistered behavior probes cover defaults,opt-ins,primitive/empty cases,hooks and exception identity; manual review may reveal additional failures without overwriting frozen grades.',
 decision:'27 fixed assignments: three fresh constructed multi-file tasks on previously unmeasured Commander13.1.0,three dependent repeats and three rotated serial arms. No outcome-based selection,model retries,reference solution recovery or private grader feedback. Every failure,timeout,missing usage and unexecuted slot is retained. No population equivalence or absence of further improvement margin claim.',
 priorCampaignRule:'F28/F29 outcomes remain separate. Earlier Lodash traces are known diagnostic controls only,never new confirmations.',
 taskEnvironment:'Node24.19.0; pinned npm lock/dependency tree. Public protected launcher uses Jest.run with serial/coverage flags out of process.argv and removes inherited NO_COLOR only inside that test process. All108 original suites/assertions retained. Full JS/TS checks remain mandatory.'};
protocol.decisionGate={"qualityFirst":"Do not promote if candidate has fewer full audited completions or behavior passes than baseline in any task cluster, or introduces a reproducible behavior/type defect in the local guards. Keep stochastic and causal attribution limits explicit.","resourceSignal":"At no lower audited quality, look for at least10% reduction in strict paired tokens or estimated cost, with estimated cost increase no greater than5% and worker time increase no greater than10%. A selected-success subset cannot override all-attempt quality.","retain":"If quality and resource gates pass across this fixed panel, retain concise descriptions provisionally with unchanged runtime guards; still require independent real-issue confirmation before a population gain claim.","mixedOrAdverse":"Keep the prototype isolated and investigate the observed mediator; do not extend the panel or revise criteria after outcomes to force a positive result."};
await mkdir(work,{recursive:true});await writeFile(join(study,'protocol.json'),JSON.stringify(protocol,null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'native-search-bindings.json'),await readFile(join(parentRoot,'native-search-bindings.json')),{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,planned:order.length,priorAccountedUsd:ledger.accountedUsd,readyForModel:false}));
