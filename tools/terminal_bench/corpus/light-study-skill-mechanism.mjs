import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
const directory=resolve(process.argv[2]);
const raw=await readFile(join(directory,'results.json'));
const results=JSON.parse(raw), ledger=JSON.parse(await readFile(join(directory,'tool-ledger.json'),'utf8'));
const rows=[];
for (const row of results.rows) {
  const execution=JSON.parse(gunzipSync(await readFile(join(directory,'traces',`${row.name}.result.json.gz`))));
  const tools=ledger.find(x=>x.name===row.name).tools;
  const skills=tools.filter(x=>x.tool==='skills').map(x=>x.input);
  const unused=tools.filter(x=>x.tool==='run_commands').map(x=>Object.fromEntries(Object.entries(x.input).filter(([key])=>key!=='commands'))).filter(x=>Object.keys(x).length);
  const blockedEditsByCategory={};
  const records=gunzipSync(await readFile(join(directory,'traces',`${row.name}.events.jsonl.gz`))).toString().trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  for(const {event} of records.filter(({event})=>event?.type==='tool'&&event.payload.phase==='finished')) {
    const tool=event.payload.toolCall?.name??event.payload.tool;
    const output=event.payload.output??event.payload.result;
    if(tool!=='edit_code'||output?.status!=='blocked')continue;
    const category=output.category??'unspecified';blockedEditsByCategory[category]=(blockedEditsByCategory[category]??0)+1;
  }
  const context=execution.metrics?.context;
  rows.push({name:row.name,id:row.id,repetition:row.repetition,arm:row.arm,
    auditedCompletion:row.auditedSuccess&&row.status==='succeeded',skills,
    modelRequests:context?.modelRequests??null,toolCalls:execution.metrics?.tools?.calls??null,
    nativeRunCommandsUnusedKeys:row.arm==='cline'?unused.reduce((n,x)=>n+Object.keys(x).length,0):null,
    nativeRunCommandsUnusedBytes:row.arm==='cline'?unused.reduce((n,x)=>n+Buffer.byteLength(JSON.stringify(x)),0):null,
    blockedEditsByCategory,
    repeatedComposedBytes:row.arm==='cline'?null:context?.composition?.composedBytes??null,
    repeatedMessageBytes:row.arm==='cline'?null:context?.composition?.messageBytes??null,
    repeatedCategoryBytes:row.arm==='cline'?null:context?.composition?.categoryBytes??null});
}
const summaries={};
for (const arm of ['baseline','modified','cline']) {
  const selected=rows.filter(x=>x.arm===arm);
  summaries[arm]={trials:selected.length,loadedSkillTrials:selected.filter(x=>x.skills.length).length,
    skillCalls:selected.reduce((a,x)=>a+x.skills.length,0),modelRequests:selected.reduce((a,x)=>a+(x.modelRequests??0),0),
    toolCalls:selected.reduce((a,x)=>a+(x.toolCalls??0),0),
    missingModelRequestTrials:selected.filter(x=>x.modelRequests===null).length,
    missingToolCallTrials:selected.filter(x=>x.toolCalls===null).length,
    nativeRunCommandsUnusedKeys:arm==='cline'?selected.reduce((n,x)=>n+x.nativeRunCommandsUnusedKeys,0):null,
    nativeRunCommandsUnusedBytes:arm==='cline'?selected.reduce((n,x)=>n+x.nativeRunCommandsUnusedBytes,0):null,
    blockedEditsByCategory:selected.reduce((counts,row)=>{for(const [key,n] of Object.entries(row.blockedEditsByCategory))counts[key]=(counts[key]??0)+n;return counts;},{}),
    repeatedSkillResultBytes:arm==='cline'?null:selected.reduce((a,x)=>a+(x.repeatedCategoryBytes?.['tool_result.skills']??0),0)};
}
const result={sourceResultsSha256:createHash('sha256').update(raw).digest('hex'),
  method:'All recorded trials, including failures. Skill calls and repeated context category bytes describe the proposed mechanism. Supplemental unused native run_commands fields and blocked-edit categories were added during source review, not preregistered causal endpoints. Frozen SDK executes the commands field only; unused-field bytes describe recorded arguments, not billed-token attribution or a reason to subtract usage. Bytes are not billed tokens; native composition was not instrumented and remains null. Missing request/tool counters are counted explicitly; sums are observed. Runtime completion and reconciled resource cohorts are computed separately.',
  summaries,rows};
await writeFile(join(directory,'skill-mechanism.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(summaries));
