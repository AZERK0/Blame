// Recorded input diagnostic for a later production-only error clarification.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const name='1-lodash-predicate-own-filter-candidate';
const bytes=await readFile(join(work,'f29',name,'events.jsonl'));
const calls=bytes.toString().trim().split('\n').map(JSON.parse).map(r=>r.event)
 .filter(e=>e.type==='tool'&&e.payload.phase==='finished').map(e=>e.payload);
const inputs=calls.filter(c=>c.toolCall.name==='read_code'&&c.toolCall.input.target?.startsWith('lodash.js# ')).map(c=>c.toolCall.input);
assert.equal(inputs.length,5);
const source=await readFile(join(repo,'.blame/research/scope-followup/upstreams/lodash/lodash.js'));
const rows=[];
for(const [stage,runtime]of Object.entries({before:join(work,'frozen/f29/baseline/agent-runtime/dist/harness'),after:join(repo,'packages/agent-runtime/dist/harness')})){
 const root=await mkdtemp(join(tmpdir(),'qualified-target-replay-'));
 try{
  await writeFile(join(root,'lodash.js'),source);
  const {LightWorkspace}=await import(join(runtime,'light-workspace.js'));
  const workspace=new LightWorkspace(root,{sessionId:'qualified-target-'+stage}),outcomes=[];
  for(const input of inputs){
   const result=await workspace.readCode(input,{});assert.equal(result.status,'blocked');
   const marker='Suggested read_code input: ',offset=result.message.indexOf(marker);
   let followup;
   if(offset>=0){
    const suggested=JSON.parse(result.message.slice(offset+marker.length));
    const accepted=await workspace.readCode(suggested,{});assert.equal(accepted.status,'ok');
    assert.equal(accepted.data.qualifiedName,input.target.split('#').at(-1).trim());
    followup={input:suggested,status:accepted.status,qualifiedName:accepted.data.qualifiedName};
   }
   const exactControlInput={...input,target:input.target.slice(0,input.target.lastIndexOf("#")+1)+input.target.split("#").at(-1).trim()};
   const exactControl=followup?{status:followup.status}:await workspace.readCode(exactControlInput,{});
   outcomes.push({input,result,exactControl:{input:exactControlInput,status:exactControl.status,...(exactControl.message?{message:exactControl.message}:{})},...(followup?{followup}:{})});
  }
  assert.deepEqual(await readFile(join(root,'lodash.js')),source);
  rows.push({stage,aliasesModuleSha256:sha(await readFile(join(runtime,'light-aliases.js'))),sourceUnchanged:true,outcomes});
 }finally{await rm(root,{recursive:true,force:true});}
}
assert(rows[0].outcomes.every(r=>!r.followup));
assert(rows[1].outcomes.some(r=>r.followup));
await writeFile(join(study,'qualified-target-replay.json'),JSON.stringify({paidRequests:0,postSelectedDiagnostic:true,
 implementedAfterFrozenTreatments:true,trial:name,eventsSha256:sha(bytes),sourceSha256:sha(source),rows,
 interpretation:'Five original padded reads remain blocked; later messages distinguish a fresh missing exact name from a stale alias and propose a selector only for uniquely indexed,non-conflicting names. Unindexed names remain blocked and suggest a text/range route. Explicit researcher-chosen followup reads succeed without source edits. This is local recovery evidence,not measured model adoption or a new task success. Ranking remains disabled in production.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,originalInputs:inputs.length,explicitFollowups:rows[1].outcomes.filter(r=>r.followup).length,sourceUnchanged:true}));
