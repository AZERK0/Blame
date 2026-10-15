// Exploratory recorded-clock decomposition; not a provider latency benchmark.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {study} from './paths.mjs';
const json=async name=>JSON.parse(await readFile(join(study,name),'utf8'));
const results=await json('results.json'),inventory=await json('inventory.json');
const wire=JSON.parse(gunzipSync(await readFile(join(study,'wire-contracts.json.gz'))));
const union=intervals=>{
 let total=0,start=null,end=null;
 for(const [a,b]of intervals.filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>=a).sort((x,y)=>x[0]-y[0])){
  if(start===null){start=a;end=b;}else if(a<=end)end=Math.max(end,b);else{total+=end-start;start=a;end=b;}
 }return total+(start===null?0:end-start);
};
const rows=[];
for(const row of results.rows){
 const entry=inventory.find(e=>e.trial===row.name&&e.file==='events.jsonl');
 const records=gunzipSync(await readFile(join(study,entry.artifact))).toString().trim().split('\n').filter(Boolean).map(JSON.parse);
 const calls=new Map(),usageTimes=[];
 for(const record of records){
  const event=record.event,time=Date.parse(record.recordedAt);
  if(event.type==='usage')usageTimes.push(time);
  if(event.type!=='tool')continue;
  const p=event.payload,id=p.toolCall?.id??p.toolCallId;if(!id)continue;
  const call=calls.get(id)??{name:p.toolCall?.name??p.tool};
  if(p.phase==='started')call.start??=time;if(p.phase==='finished')call.end=time;calls.set(id,call);
 }
 const tools=[...calls.values()],complete=tools.filter(t=>Number.isFinite(t.start)&&Number.isFinite(t.end));
 const requests=wire.trials.find(t=>t.name===row.name).requests.filter(r=>!r.budgetRejected);
 const paired=requests.length===usageTimes.length;
 const requestIntervals=paired?requests.map((r,i)=>[Date.parse(r.time),usageTimes[i]]):[];
 const toolIntervals=complete.map(t=>[t.start,t.end]);
 const covered=union([...requestIntervals,...toolIntervals]);
 rows.push({name:row.name,id:row.id,arm:row.arm,repetition:row.repetition,
  workerSeconds:row.durationMs===null?null:row.durationMs/1000,outerAgentSeconds:row.outerAgentMs===null?null:row.outerAgentMs/1000,
  toolIntervals:complete.length,incompleteToolIntervals:tools.length-complete.length,
  toolWallUnionSeconds:union(toolIntervals)/1000,
  commandWallUnionSeconds:union(complete.filter(t=>['run_task','run_commands'].includes(t.name)).map(t=>[t.start,t.end]))/1000,
  requestUsageCountsMatch:paired,approximateDispatchToUsageUnionSeconds:paired?union(requestIntervals)/1000:null,
  negativeRequestIntervals:requestIntervals.filter(([a,b])=>b<a).length,
  unattributedWorkerSeconds:paired&&row.durationMs!==null?(row.durationMs-covered)/1000:null});
}
const output={method:'Post hoc diagnostic from actual wire timestamps and raw event recordedAt values. Wall unions avoid double counting parallel calls. Dispatch-to-usage includes streaming/network/provider/event transport; it is not isolated model inference time. Missing request/usage correspondence prevents decomposition. Residual includes startup/projection/scheduling and timestamp error, not a measured harness-only cost. Administrative pauses,preparation and independent grading are separate.',rows};
await writeFile(join(study,'timing-analysis.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({rows:rows.length,example:rows.filter(r=>r.id==='rxjs-promise-abort-config'&&['baseline','bundle','cline'].includes(r.arm))}));
