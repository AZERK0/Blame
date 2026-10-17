// Tool observations, not inferred model reasoning or causal effect estimates.
import{join}from'node:path';import{work,study,json,save}from'./setup.mjs';
const {rows}=await json(join(work,'campaign/analysis.json'));const records=[];
for(const row of rows){const tools=await json(join(work,'campaign',row.name,'tool-ledger.json'));const observations=[];
 for(const [index,t]of tools.entries()){
  const out=t.output,message=out?.message??'';
  if(t.tool==='read_code'&&out?.status==='blocked')observations.push({index,category:/ENOENT/.test(message)?'missing_path':'read_guard',tool:t.tool,input:t.input,message});
  if(t.tool==='edit_code'&&out?.status!=='ok')observations.push({index,category:out?.patchCorrection?.reason==='context_outside_symbol'||/outside.*symbol|symbol.*outside/i.test(message)?'patch_scope':/parse failed|syntax/i.test(message)?'invalid_final_syntax':/observ|read|coverage/i.test(message)?'edit_observation_guard':/context|match|header|patch/i.test(message)?'patch_preimage_or_format':'other_edit_refusal',tool:t.tool,input:t.input,output:out});
  if(t.tool==='run_task'&&Number.isInteger(out?.data?.exitCode)&&out.data.exitCode!==0)observations.push({index,category:'executed_command_failed',tool:t.tool,input:t.input,command:out.data.command,exitCode:out.data.exitCode});
  if(t.tool==='run_task'&&out?.status==='blocked'&&/^Command exited with code \d+\./.test(message))observations.push({index,category:'command_failure_reported_in_message',tool:t.tool,input:t.input,reportedExitCode:Number(message.match(/^Command exited with code (\d+)\./)[1])});
  if(t.tool==='run_commands')for(const value of Array.isArray(out)?out:[])if(value.success===false)observations.push({index,category:'native_command_failed',tool:t.tool,command:value.query});
 }
 const categories=Object.fromEntries([...new Set(observations.map(x=>x.category))].sort().map(k=>[k,observations.filter(x=>x.category===k).length]));
 records.push({name:row.name,task:row.task,arm:row.arm,categories,observations,declarationCalls:row.declarationCalls,compilerAdmitted:row.completion?.satisfied_obligations?.includes('check:types')??null,sourceVerification:row.completion?.verification??null});
}
const arms=Object.fromEntries(['reference','compiler','cline'].map(arm=>{const selected=records.filter(r=>r.arm===arm);const categories={};for(const row of selected)for(const[k,n]of Object.entries(row.categories))categories[k]=(categories[k]??0)+n;return[arm,{trials:selected.length,categories,declarationCalls:selected.reduce((n,r)=>n+r.declarationCalls,0)}];}));
await save(join(study,'friction-observations.json'),{complete:rows.length===54,method:'Observed tool failures/guards. A refusal may be correct; its occurrence does not establish harness fault, model reasoning, or causal token overhead. Native command failures and Light edit/read categories are not equivalent tools.',arms,records});console.log(JSON.stringify(arms));
