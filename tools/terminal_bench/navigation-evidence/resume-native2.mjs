// Administrative F27 continuation only: never rerun an assigned model trial.
// Reuse the byte-pinned dispatch/scoring functions, fixed order and financial gate.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {repo,work,studyFor} from './campaign-paths.mjs';
assert.equal(process.env.BLAME_STUDY_VARIANT,'native2');
assert.equal(process.argv[2],'run');assert.equal(process.argv[3],'f27');
const campaign=join(work,'f27'),study=studyFor('f27'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const recovery=await json(join(campaign,'orchestration-recovery.json'));
const analysis=await json(join(campaign,'analysis.json'));
assert.equal(analysis.completed,24,'Recover the recorded 24th result locally first');
assert.equal(recovery.completedBeforeLoss,23);assert.equal(recovery.affectedTrial,'1-zod-record-own-presence-cline');
assert(analysis.rows.every((r,i)=>r.name===analysis.provenance.order.slice(0,24).map(t=>[t.repetition,t.id,t.arm].join('-'))[i]));
const registered=join(repo,'tools/terminal_bench/navigation-evidence/run.mjs');
const original=await readFile(registered,'utf8');
const bindings=await json(join(study,'execution-bindings.json'));
assert.equal(sha(original),bindings.inputs['tools/terminal_bench/navigation-evidence/run.mjs']);
let generated=original;
function replaceOnce(before,after){assert.equal(generated.split(before).length,2,'Unique administrative anchor required');generated=generated.replace(before,after);}
replaceOnce('  await mkdir(campaign);','  // Preserve the existing campaign and its original registration.');
replaceOnce(`  await writeJson(join(campaign, "provenance.json"), { frozen, order,
    startedAt: new Date().toISOString(), protocolSha256: sha(await readFile(join(study, "protocol.json"))) });`,
`  const originalProvenance = JSON.parse(await readFile(join(campaign,"provenance.json"),"utf8"));
  if (JSON.stringify(originalProvenance.frozen)!==JSON.stringify(frozen) ||
      JSON.stringify(originalProvenance.order)!==JSON.stringify(order) ||
      originalProvenance.protocolSha256!==sha(await readFile(join(study,"protocol.json"))))
    throw Error("Administrative resume must retain exact original provenance");`);
replaceOnce(`  await writeJson(join(campaign, "shared-budget-accounting.json"), { priorAccounting, priorObservedCost,
    sharedCeilingUsd: protocol.budgets.sharedStudyObservedCostStopUsd });`,
`  const originalAccounting = JSON.parse(await readFile(join(campaign,"shared-budget-accounting.json"),"utf8"));
  if (JSON.stringify(originalAccounting)!==JSON.stringify({priorAccounting,priorObservedCost,sharedCeilingUsd:protocol.budgets.sharedStudyObservedCostStopUsd}))
    throw Error("Prior spending/reserves changed; never reset them at resume");`);
replaceOnce('  let observedCost = 0;',
`  const resumedRows = await analyze();
  const resumedNames = new Set(resumedRows.map(r=>r.name));
  if (JSON.stringify([...resumedNames])!==JSON.stringify(order.slice(0,resumedRows.length).map(t=>[t.repetition,t.id,t.arm].join("-"))))
    throw Error("Only a completed prefix of the registered order may resume");
  let observedCost = (await campaignBudget(resumedRows,campaign)).accountedUsd;`);
replaceOnce('  for (const trial of order) {',
`  for (const trial of order) {
    if (resumedNames.has([trial.repetition,trial.id,trial.arm].join("-"))) continue;`);
// Only import locations change; dispatch, verification, workspace preparation,
// watchdog and scoring function bodies remain byte-identical to registration.
generated=generated.replace(/from "(\.{1,2}\/[^\"]+)"/g,(_all,spec)=>'from '+JSON.stringify(new URL(spec,pathToFileURL(registered)).href));
for(const name of ['executeModel','score','prepareWorkspace','verifyBindings','campaignBudget']){
 const pattern=new RegExp('async function '+name+'\\([^]*?(?=\\n(?:async )?function |\\nif \\(process\\.argv)');
 assert.equal(generated.match(pattern)?.[0],original.match(pattern)?.[0],name+' must remain unchanged');
}
const driver=join(campaign,'resume-driver.mjs');
await mkdir(join(campaign,'.resume-lock'));
try{
 await writeFile(driver,generated,{flag:'wx'});
 const manifest={resumedAtUTC:new Date().toISOString(),originalDriverSha256:sha(original),administrativeDriverSha256:sha(generated),remainingSlots:12,
   completedPrefix:24,protocolSha256:analysis.provenance.protocolSha256,modelRetries:0,provenanceRewritten:false,
   unchangedFunctions:['executeModel','score','prepareWorkspace','verifyBindings','campaignBudget'],
   note:'Administrative loss after completed model result24; missing outer metadata stays null. Skip exactly the completed prefix and retain all budgets/reserves.'};
 await writeFile(join(campaign,'resume-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
 await import(pathToFileURL(driver));
 await writeFile(join(campaign,'resume-completed.json'),JSON.stringify({finishedAtUTC:new Date().toISOString(),...((await json(join(campaign,'analysis.json'))).completed===36?{completed:36}:{stoppedBefore36:true})},null,2)+'\n');
}finally{await rm(join(campaign,'.resume-lock'),{recursive:true,force:true});}
