// Known failed read inputs against pristine source, not a conversation replay.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {repo,work as previous,prepare,json,save,sha} from '../confirmation-study/setup.mjs';
const study=join(repo,'docs/experiments/light-harness-path-recovery-f43-2026-10-17');
const work=join(repo,'.blame/research/path-recovery-f43');await mkdir(work,{recursive:true});
const startedAtUTC=new Date().toISOString();
const analysis=await json(join(previous,'campaign/analysis.json'));
const cases=new Map();
for(const row of analysis.rows.slice(0,10)){
  const tools=await json(join(previous,'campaign',row.name,'tool-ledger.json'));
  for(const[index,t]of tools.entries())if(t.tool==='read_code'&&t.output?.status==='blocked'&&/ENOENT/.test(t.output.message??'')){
    const project=row.task.split('-')[0],key=JSON.stringify({project,input:t.input});
    const value=cases.get(key)??{project,input:t.input,observations:[]};
    value.observations.push({name:row.name,toolIndex:index,ledgerSha256:row.hashes['tool-ledger.json']});cases.set(key,value);
  }
}
const runtimes={baseline:join(previous,'frozen/compiler/agent-runtime/dist/harness'),candidate:join(repo,'packages/agent-runtime/dist/harness')};
const records=[],bindings={};
for(const[arm,runtime]of Object.entries(runtimes)){
  bindings[arm]={workspace:sha(await readFile(join(runtime,'light-workspace.js'))),recovery:await readFile(join(runtime,'light-path-recovery.js')).then(sha,()=>null)};
  const {LightWorkspace}=await import(join(runtime,'light-workspace.js'));
  for(const project of ['valibot','remeda']){
    const root=join(work,`replay-${arm}-${project}`);await prepare(root,project==='valibot'?'valibot-message-prefix':'remeda-stable-sum');
    let sequence=0;
    try{for(const input of [...cases.values()].filter(c=>c.project===project)){
      const workspace=new LightWorkspace(root,{sessionId:`read-replay-${sequence++}`});
      const result=await workspace.readCode(input.input,{});assert.equal(result.status,'blocked');
      const hint=result.recovery?JSON.parse(result.recovery):null;
      const reads=[];
      for(const candidate of hint?.candidates??[]){const next=await workspace.readCode(candidate.nextRead,{});assert.equal(next.status,'ok');assert.equal(next.data.path,candidate.path);reads.push({path:candidate.path,status:next.status,view:next.data.view});}
      records.push({...input,arm,result:JSON.parse(JSON.stringify(result).replaceAll(root,'<WORKSPACE>')),reads});
      assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'');
    }}finally{await rm(root,{recursive:true,force:true});}
  }
}
const summary=Object.fromEntries(Object.keys(runtimes).map(arm=>{const rows=records.filter(r=>r.arm===arm);return[arm,{cases:rows.length,hints:rows.filter(r=>r.reads.length).length,suggestedReadsSucceeded:rows.reduce((n,r)=>n+r.reads.length,0)}];}));
await save(join(study,'known-read-replay.json'),{startedAtUTC,endedAtUTC:new Date().toISOString(),modelRequests:0,
  scope:'Distinct failed read inputs observed in the first 10 F42 assignments, executed on pristine study source. This is a known diagnosis, not an agent rerun, exact intermediate-state reconstruction or evidence of token savings. Unit controls separately prove no edit coverage is granted.',bindings,summary,records});
console.log(JSON.stringify(summary));
