// Assemble an audit only after a human supervising agent has inspected every trace.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(process.argv[2]);
const destination=resolve(process.argv[3]);
const json=async (file)=>JSON.parse(await readFile(file,'utf8'));
const analysis=await json(join(root,'analysis.json'));
const reviews=await json(join(root,'../review-progress.json'));
const candidates=await json(join(root,'audit-candidates.json'));
const lifecycle=await json(join(root,'tool-lifecycle-inspection.json'));
assert.equal(analysis.completed,analysis.planned);
assert.equal(new Set(reviews.decisions.map(x=>x.name)).size,analysis.planned);
assert.equal(lifecycle.trials.length,analysis.planned);
assert.ok(lifecycle.trials.every(x=>!(x.missingIds.length||x.startedWithoutFinish.length||x.differentInputs.length||x.finishedWithoutStart.length)));
const supplements={};
for (const [id,file,field] of [['webhook-idempotency','webhook-replay.json','passed'],['stable-pagination','pagination-replay.json','passed'],['async-cache','cache-replay.json','passed'],['large-create','seed-audit.json','passed']])
  if(analysis.rows.some(r=>r.id===id)) supplements[id]={file,field,data:await json(join(root,file))};
const reducer=analysis.rows.some(r=>r.id==='stale-save-reducer')?await json(join(root,'reducer-replay.json')):null;
for (const d of candidates.decisions) {
  const row=analysis.rows.find(r=>r.name===d.name), review=reviews.decisions.find(r=>r.name===d.name);
  assert.equal(review.review,'reviewed');
  for(const [filename,field] of [['events.jsonl','eventsSha256'],['workspace.diff','diffSha256']]) {
    const actual=createHash('sha256').update(await readFile(join(root,d.name,filename))).digest('hex');assert.equal(actual,review[field]);assert.equal(actual,row[field]);
  }
  Object.assign(d,review,{registeredObligationsSuccess:d.functionalSuccess&&d.taskObligations,independentSuccess:d.independentSuccessCandidate,retrievalObserved:false});
  if(typeof review.criteriaOverride==='boolean') {assert.ok(review.overrideEvidence);d.independentSuccess=review.criteriaOverride;}
  if(supplements[row.id]) {
    const {file,field,data}=supplements[row.id],r=data.rows.find(r=>r.name===d.name);assert.ok(r);
    d.supplementalReplay={artifact:file,passed:r[field],sourceSha256:r.sourceSha256};
    d.independentSuccess&&=Boolean(r[field]);
    if(row.id==='stable-pagination')d.normalizedTimestampSensitivitySuccess=d.independentSuccessCandidate;
  }
  if(row.id==='stale-save-reducer') {
    const r=reducer.rows.find(r=>r.name===d.name);assert.ok(r);
    d.valueSemanticsReplay={artifact:'reducer-replay.json',sourceSha256:r.sourceSha256,passed:r.valueSemanticsPassed,physicalAbsencePassed:r.physicalAbsencePassed};
    d.valueSemanticsSensitivitySuccess=Boolean(r.valueSemanticsPassed&&d.taskObligations&&row.unexpectedPaths.length===0&&row.checks.every(c=>c.passed||['start clears error','active completion behavior'].includes(c.name))&&row.auditCandidates===0);
  }
  d.auditedCompletion=d.independentSuccess&&row.status==='succeeded';
}
candidates.method='Unblinded supervising-agent inspection of every recorded tool input and source change, including byte-identical references to prior fully reviewed evidence. Raw lifecycle coverage checked independently. Bounded recorded-action audit, not a certificate of unrecorded behavior. No source repair or solution recovery.';
candidates.reviewedAt=new Date().toISOString();
candidates.endpoint='Registered instruction criteria AND successful runtime completion, with original official/functional/build/admission/termination results and known criterion conventions kept separate.';
await writeFile(join(root,'adjudication.json'),JSON.stringify(candidates,null,2)+'\n');
await writeFile(join(destination,'source-review.json'),JSON.stringify({...reviews,status:'complete',completed:analysis.completed,planned:analysis.planned,method:candidates.method},null,2)+'\n');
console.log(JSON.stringify({reviewed:reviews.decisions.length,decisions:candidates.decisions.length}));
