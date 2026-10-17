// Evidence extraction only. Acceptance requires explicit source/delivery review.
import {readFile} from 'node:fs/promises';import {join} from 'node:path';import {work,study,json,save} from './setup.mjs';
const analysis=await json(join(work,'campaign/analysis.json'));const packets=[];
for(const row of analysis.rows){
 const dir=join(work,'campaign',row.name),tools=await json(join(dir,'tool-ledger.json'));
 const lastEdit=tools.findLastIndex(t=>t.tool==='edit_code'&&t.output?.status==='ok'||t.tool==='apply_patch'&&t.output?.success===true);
 const commands=[];
 for(const [index,t]of tools.entries()){
  if(t.tool==='run_task'&&t.output?.data?.command)commands.push({index,input:t.input,command:t.output.data.command,exitCode:t.output.data.exitCode??null,processSuccess:t.output.data.exitCode===0,check:t.output.data.check??null});
  else if(t.tool==='run_task'&&t.output?.status==='blocked')commands.push({index,input:t.input,command:t.input?.command??`[project task ${t.input?.task??'unknown'}]`,exitCode:null,processSuccess:false,reportedExitCode:t.output.message?.match(/^Command exited with code (\d+)\./)?.[1]??null,output:t.output.message});
  if(t.tool==='run_commands')for(const o of Array.isArray(t.output)?t.output:[])commands.push({index,input:t.input,command:o.query,exitCode:null,processSuccess:o.success===true,output:o.output??o.result??o});
 }
 const required=Object.fromEntries(['regression','feature','types'].map(name=>[name,commands.filter(c=>(c.command===`npm run test:study:${name}` || c.command.split(' && ').every(s=>/^npm run test:study:(regression|feature|types)$/.test(s)) && c.command.split(' && ').includes(`npm run test:study:${name}`))&&c.index>lastEdit&&c.processSuccess)]));
 const events=(await readFile(join(dir,'events.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse).map(r=>r.event);
 const delivery=events.findLast(e=>e.type==='done')?.payload?.text??tools.findLast(t=>t.tool==='finish_task')?.input?.summary??null;
 const blocked=tools.filter(t=>t.output?.status==='blocked').map(t=>({tool:t.tool,input:t.input,output:t.output}));
 const scopeCommands=commands.filter(c=>/curl|wget|git\s+(?:show|log|fetch|clone)|\.\.\/|\/workspace\/Blame(?!\/\.blame\/research\/confirmation-f42\/campaign\/)/.test(c.command));
 packets.push({name:row.name,hashes:row.hashes,official:row.officialRuntimeSuccess,functional:row.independentFunctionalSuccess,lastEdit,required,commands,delivery,blocked,scopeCommands,completion:row.completion});
}
await save(join(study,'audit-packets.json'),{complete:analysis.rows.length===54,packets});
console.log(JSON.stringify(packets.map(p=>({name:p.name,official:p.official,functional:p.functional,required:Object.fromEntries(Object.entries(p.required).map(([k,v])=>[k,v.length])),blocked:p.blocked.length}))));
