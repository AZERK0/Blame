// Draft task/version registration. Final financial binding follows complete F28;
// readyForModel remains false until explicit local controls and finalization.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,work,study} from './paths.mjs';
const parent=JSON.parse(await readFile(join(repo,'docs/experiments/light-harness-guidance-f28-2026-10-15/protocol.json')));
const selection=JSON.parse(await readFile(join(study,'task-selection.json'))),arms=['baseline','candidate','cline'],order=[];
for(let repetition=1;repetition<=3;repetition++)for(const [index,task]of selection.tasks.entries())for(let offset=0;offset<3;offset++)order.push({repetition,id:task.id,arm:arms[(offset+index+repetition-1)%3]});
const p={studyKind:'bounded-lexical-phrase-priority',registeredAtUTC:new Date().toISOString(),readyForModel:false,
 taskSelectionAtUTC:selection.selectedAtUTC,taskInputCommitAtUTC:parent.taskInputCommitAtUTC,
 provider:parent.provider,model:parent.model,effort:parent.effort,apiUrl:parent.apiUrl,
 arms,lightArms:['baseline','candidate'],clineRuntimeArm:'baseline',repetitions:3,order,tasks:selection.tasks,
 upstreams:{lodash:parent.upstreams.lodash},nativeSearchRepair:true,captureWireContracts:true,
 budgets:{...parent.budgets,panelObservedCostStopUsd:2},budgetAmendment:parent.budgetAmendment,
 priorBudget:'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15/prior-budget.json',
 driverInputs:['run.mjs','paths.mjs','register.mjs','freeze.mjs','features.mjs','tasks.mjs','task-controls.mjs','runtime-controls.mjs','local-controls.mjs','prompt-date.mjs','prompt-date-controls.mjs'],
 environmentArtifacts:['tools/terminal_bench/guidance-study/paths.mjs',
 'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15/task-selection.json',
 'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15/local-controls.json',
 'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15/candidate.patch',
 'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15/prior-budget.json'],
 hypothesis:{mechanism:'Common OR terms fill the32-match lexical pool before late declarations are ranked. A separate bounded contiguous-term pass prioritizes specific matches; original OR fallback,path priority,limits,scope and read-before-edit authority remain.',
 comparison:'Current all-six F28 bundle baseline versus the same source plus the two-file ranking patch, plus the same repaired integrated native SDK. Identical normalized tool schemas and system prompts between Light arms. No edit/validation/description change in this contrast.',
 measures:['all-attempt official,functional,actual-check and audited completion','conditional paired tokens,cache,estimated cost,worker/outer duration','multi-term lexical calls and repeated/empty searches'],
 risks:['extra ripgrep scan and IO','different ordering can hide useful individual-term hits under the unchanged cap','Node fallback prioritizes within each visited file,not a global exhaustive ranking']},
 audit:parent.audit,
 decision:'Two fresh constructed tasks in one familiar monolithic project and related option-extension family,three dependent repeats,18 fixed assignments. Known F28 searches are mechanism diagnostics only. Preserve every failure,timeout,missing usage and unexecuted slot. No model retry,source repair,reference recovery or grader feedback. Raw output alone does not establish model-visible evidence; unblinded audit and arm-labeled checkout limitations remain. No population-equivalence or universally optimal ranking claim.',
 priorCampaignRule:'F28 contributes only its completed cumulative observed/reserved financial ledger. Keep outcome cohorts,versions,tasks and conditional efficiency comparisons separate.'};
await mkdir(work,{recursive:true});await writeFile(join(study,'protocol.json'),JSON.stringify(p,null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'native-search-bindings.json'),await readFile(join(repo,'docs/experiments/light-harness-guidance-f28-2026-10-15/native-search-bindings.json')),{flag:'wx'});
console.log(JSON.stringify({planned:order.length,readyForModel:false,paidRequests:0}));
