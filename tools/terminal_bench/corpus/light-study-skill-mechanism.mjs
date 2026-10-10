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
  const skills=ledger.find(x=>x.name===row.name).tools.filter(x=>x.tool==='skills').map(x=>x.input);
  const context=execution.metrics?.context;
  rows.push({name:row.name,id:row.id,repetition:row.repetition,arm:row.arm,
    auditedCompletion:row.auditedSuccess&&row.status==='succeeded',skills,
    modelRequests:context?.modelRequests??null,toolCalls:execution.metrics?.tools?.calls??null,
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
    repeatedSkillResultBytes:arm==='cline'?null:selected.reduce((a,x)=>a+(x.repeatedCategoryBytes?.['tool_result.skills']??0),0)};
}
const result={sourceResultsSha256:createHash('sha256').update(raw).digest('hex'),
  method:'All recorded trials, including failures. Skill calls and repeated context category bytes describe the proposed mechanism. Bytes are not billed tokens; native composition was not instrumented and remains null. Runtime completion and reconciled resource cohorts are computed separately.',
  summaries,rows};
await writeFile(join(directory,'skill-mechanism.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(summaries));
