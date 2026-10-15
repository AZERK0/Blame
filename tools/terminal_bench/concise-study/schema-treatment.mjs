// Read-only check of actual first requests,not just source-level tool factories.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async n=>JSON.parse(await readFile(join(study,n)));
const results=await json('results.json'),protocol=await json('protocol.json');
const archive=JSON.parse(gunzipSync(await readFile(join(study,'wire-contracts.json.gz'))));
const changed=['edit_code','finish_task','read_code','run_task','search_code'],rows=[];
for(const row of results.rows.filter(r=>r.arm!=='cline')){
 const request=archive.trials.find(t=>t.name===row.name).requests.find(r=>!r.budgetRejected);if(!request)continue;
 const score=JSON.parse(gunzipSync(await readFile(join(study,'traces',row.name+'.score.json.gz'))));
 const tools=archive.contracts['schema-'+request.toolsSha256+'.json'],prompt=archive.contracts['prompt-'+request.promptSha256+'.json'];
 const withoutDescriptions=tools.map(t=>changed.includes(t.name)?Object.fromEntries(Object.entries(t).filter(([k])=>k!=='description')):t);
 rows.push({name:row.name,id:row.id,repetition:row.repetition,arm:row.arm,toolsSha256:request.toolsSha256,promptSha256:request.promptSha256,
  normalizedPromptSha256:sha(JSON.stringify(prompt).replaceAll(score.selected.cwd,'<WORKSPACE>')),
  unchangedToolContractSha256:sha(JSON.stringify(withoutDescriptions)),schemaBytes:Buffer.byteLength(JSON.stringify(tools)),
  descriptionBytes:tools.filter(t=>changed.includes(t.name)).reduce((n,t)=>n+Buffer.byteLength(t.description),0)});
}
const pairs=[];
for(const task of protocol.tasks)for(let repetition=1;repetition<=protocol.repetitions;repetition++){
 const a=rows.find(r=>r.id===task.id&&r.repetition===repetition&&r.arm==='baseline'),b=rows.find(r=>r.id===task.id&&r.repetition===repetition&&r.arm==='candidate');if(!a||!b)continue;
 assert.equal(a.normalizedPromptSha256,b.normalizedPromptSha256);assert.equal(a.unchangedToolContractSha256,b.unchangedToolContractSha256);
 pairs.push({id:task.id,repetition,normalizedPromptsMatch:true,allOtherToolFieldsMatch:true,baselineSchemaBytes:a.schemaBytes,candidateSchemaBytes:b.schemaBytes,schemaRelativeChange:b.schemaBytes/a.schemaBytes-1,baselineDescriptionBytes:a.descriptionBytes,candidateDescriptionBytes:b.descriptionBytes,descriptionRelativeChange:b.descriptionBytes/a.descriptionBytes-1});
}
await writeFile(join(study,'schema-treatment.json'),JSON.stringify({paidRequests:0,method:'Actual first-dispatch tools and system/developer prompts. Normalize only the original score-bound workspace path. Exactly five description fields are excluded for the tool-contract equality test. Bytes are not model/billed tokens and length is not isolated from wording emphasis.',rows,pairs},null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,lightTrials:rows.length,matchedTaskRepetitionPairs:pairs.length}));
