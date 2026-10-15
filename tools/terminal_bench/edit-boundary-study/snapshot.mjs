// Publication-only adaptation; no model calls or registered driver changes.
// Freeze an already reviewed completed prefix while the registered driver continues.
// Trial evidence is immutable after completion. Never copies or edits active trials.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {work} from './paths.mjs';
const campaign=join(work,'f31'),count=Number(process.argv[2]);
const revision=process.argv[3]??'';assert(!revision||/^[a-z][a-z-]+$/u.test(revision));
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const analysis=await json(join(campaign,'analysis.json'));
const review=await json(join(campaign,'source-review.json'));
const ledger=await json(join(campaign,'tool-ledger.json'));
assert(Number.isInteger(count)&&count>0&&count<=analysis.completed);
const rows=analysis.rows.slice(0,count),names=new Set(rows.map(r=>r.name));
for(const row of rows){
 const decision=review.decisions.find(d=>d.name===row.name);
 assert.equal(decision?.review,'reviewed',row.name);
 for(const key of ['eventsSha256','diffSha256','scoreSha256'])assert.equal(decision[key],row[key]);
 assert(ledger.some(t=>t.name===row.name));
}
const snapshot=join(work,'checkpoints',String(count)+(revision?'-'+revision:''));await mkdir(snapshot,{recursive:true});
// Exclusive marker forbids accidental replacement of a published snapshot.
await writeFile(join(snapshot,'captured-at.txt'),new Date().toISOString()+'\n',{flag:'wx'});
await writeFile(join(snapshot,'analysis.json'),JSON.stringify({...analysis,completed:count,rows},null,2)+'\n');
await writeFile(join(snapshot,'source-review.json'),JSON.stringify({...review,decisions:review.decisions.filter(d=>names.has(d.name))},null,2)+'\n');
if(revision)await writeFile(join(snapshot,'review-revision.json'),JSON.stringify({revision,priorSnapshot:String(count),reason:'Correct research-agent adjudications; preserve the previous snapshot and every original model/source/score byte.'},null,2)+'\n',{flag:'wx'});
await writeFile(join(snapshot,'tool-ledger.json'),JSON.stringify(ledger.filter(t=>names.has(t.name)),null,2)+'\n');
for(const file of ['shared-budget-accounting.json','provenance.json'])await writeFile(join(snapshot,file),await readFile(join(campaign,file)));
for(const row of rows)await symlink(join(campaign,row.name),join(snapshot,row.name),'dir');
console.log(snapshot);
