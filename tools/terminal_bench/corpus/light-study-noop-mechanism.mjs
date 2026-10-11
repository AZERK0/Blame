// Registered T4 mechanism: exposure and recovery are distinct from completion.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
const directory=resolve(process.argv[2]);
const resultBytes=await readFile(join(directory,'results.json'));
const results=JSON.parse(resultBytes), rows=[];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const trial of results.rows) {
 const raw=gunzipSync(await readFile(join(directory,'traces',trial.name+'.events.jsonl.gz')));
 const events=raw.toString().split('\n').filter(Boolean).map(line=>JSON.parse(line).event);
 let calls=0,noops=0,hints=0,changed=0,consecutiveIdenticalNoops=0,maxConsecutiveIdenticalNoops=0,previousHash;
 const observations=[];
 for(const event of events) {
  const p=event?.payload;
  if(event?.type!=='tool'||p.phase!=='finished'||(p.toolCall?.name??p.tool)!=='edit_code')continue;
  calls++;
  const input=p.toolCall?.input??p.input, output=p.output??p.result;
  const hash=sha(JSON.stringify(input));
  if(output?.status==='ok'&&output.data?.changed===false) {
   noops++;hints+=Number(typeof output.data?.guidance==='string');
   consecutiveIdenticalNoops=previousHash===hash?consecutiveIdenticalNoops+1:1;
   maxConsecutiveIdenticalNoops=Math.max(maxConsecutiveIdenticalNoops,consecutiveIdenticalNoops);
   observations.push({toolCallId:p.toolCall?.id??p.toolCallId,inputSha256:hash,guidance:output.data?.guidance??null});
   previousHash=hash;
  } else {consecutiveIdenticalNoops=0;previousHash=undefined;changed+=Number(output?.status==='ok'&&output.data?.changed===true);}
 }
 const result=JSON.parse(gunzipSync(await readFile(join(directory,'traces',trial.name+'.result.json.gz'))));
 const diagnostic=JSON.stringify(events.filter(e=>e?.type!=='tool'))+'\n'+JSON.stringify(result);
 const loopAbort=/maximum consecutive mistakes reached|Detected \d+ consecutive identical calls|stopping to avoid loop/iu.test(diagnostic)&&trial.status!=='succeeded';
 rows.push({name:trial.name,arm:trial.arm,eventsSha256:sha(raw),editCalls:calls,acceptedNoops:noops,guidanceExposures:hints,changedEdits:changed,maxConsecutiveIdenticalNoops,loopAbort,auditedCriteria:trial.auditedSuccess,auditedCompletion:trial.auditedCompletion,observations});
}
const summaries=Object.fromEntries(['baseline','modified','cline'].map(arm=>{
 const list=rows.filter(r=>r.arm===arm);
 return [arm,{trials:list.length,acceptedNoops:list.reduce((n,r)=>n+r.acceptedNoops,0),guidanceExposures:list.reduce((n,r)=>n+r.guidanceExposures,0),trialsWithNoop:list.filter(r=>r.acceptedNoops).length,trialsWithRepeatedIdenticalNoop:list.filter(r=>r.maxConsecutiveIdenticalNoops>1).length,loopAborts:list.filter(r=>r.loopAbort).length,noopExposedAuditedCompletion:list.filter(r=>r.acceptedNoops&&r.auditedCompletion).length,criteriaFailuresDespiteRuntimeSuccess:results.rows.filter(r=>r.arm===arm&&r.status==='succeeded'&&!r.auditedSuccess).length}];
}));
for(const field of ['acceptedNoops','guidanceExposures','trialsWithNoop','trialsWithRepeatedIdenticalNoop','loopAborts','noopExposedAuditedCompletion']) summaries.cline[field]=null;
const report={sourceResultsSha256:sha(resultBytes),helperSha256:sha(await readFile(new URL(import.meta.url))),method:'All full retained tool outputs and non-tool/result diagnostics. Accepted no-op means status ok and changed=false; blocked/changed outputs distinct. Consecutive-identical counts adjacent accepted edit calls, possibly separated by other tools; not an SDK state-machine reproduction. Loop abort requires explicit diagnostic and unsuccessful runtime. Native different editing API: edit_code counts unavailable, not zero native friction. Exposure-conditioned completion is descriptive, not matched causal quality. Full independent adjudication is separate.',summaries,rows};
await writeFile(process.argv[3] ? resolve(process.argv[3]) : join(directory,'noop-mechanism.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(summaries));
