// Record explicit human-agent adjudications after trace/source inspection.
// No automatic acceptance from passing tests. No source,score or event mutation.
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {work} from './paths.mjs';
const campaign=join(work,'f30'),notes=JSON.parse(await readFile(resolve(process.argv[2])));
const analysis=JSON.parse(await readFile(join(campaign,'analysis.json'))),sha=b=>createHash('sha256').update(b).digest('hex');
let review;try{review=JSON.parse(await readFile(join(campaign,'source-review.json')));}catch(e){if(e.code!=='ENOENT')throw e;review={method:'Unblinded manual source,all effective tool inputs,final-source command evidence and final-report review. Explicit decisions bound to original events/diffs/scores; not a third-party audit. Independent grading is separate and never fed back.',decisions:[]};}
for(const note of notes){
 assert(!review.decisions.some(d=>d.name===note.name),'Decision already recorded');
 const row=analysis.rows.find(r=>r.name===note.name);assert(row);
 for(const key of ['agentRequiredChecksPassed','fullRequestCriteriaPassed','manualBehaviorPassed','noSolutionRetrieval'])assert.equal(typeof note[key],'boolean',key);
 assert(note.manualBehaviorPassed||!note.fullRequestCriteriaPassed);assert(note.notes.length>120);
 for(const [file,key]of[['events.jsonl','eventsSha256'],['workspace.diff','diffSha256'],['score.json','scoreSha256']])assert.equal(sha(await readFile(join(campaign,row.name,file))),row[key]);
 review.decisions.push({...note,review:'reviewed',...Object.fromEntries(['eventsSha256','diffSha256','scoreSha256'].map(k=>[k,row[k]]))});
}
review.decisions.sort((a,b)=>analysis.rows.findIndex(r=>r.name===a.name)-analysis.rows.findIndex(r=>r.name===b.name));
const path=join(campaign,'source-review.json');await writeFile(path+'.tmp',JSON.stringify(review,null,2)+'\n');await rename(path+'.tmp',path);
console.log(JSON.stringify({completed:analysis.completed,reviewed:review.decisions.length,unreviewed:analysis.rows.filter(r=>!review.decisions.some(d=>d.name===r.name)).map(r=>r.name)}));
