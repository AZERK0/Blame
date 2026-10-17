// Descriptive timing, not a decomposition of provider compute/queue/network.
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {work as defaultWork,study as defaultStudy,json,save} from './setup.mjs';
const work=process.argv[2]?resolve(process.argv[2]):defaultWork,study=process.argv[3]?resolve(process.argv[3]):defaultStudy;
const protocol=await json(join(study,'protocol.json')),analysis=await json(join(work,'campaign/analysis.json')),records=[];
const lines=async path=>(await readFile(path,'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
for(const row of analysis.rows){
 const dir=join(work,'campaign',row.name),events=await lines(join(dir,'events.jsonl')),wire=(await lines(join(dir,'wire-contracts.jsonl'))).filter(w=>!w.budgetRejected);
 const usage=events.filter(e=>e.event.type==='usage');
 const matched=wire.length===usage.length&&wire.length>0&&wire.every((w,i)=>Date.parse(w.time)<=Date.parse(usage[i].recordedAt)&&(i===wire.length-1||Date.parse(usage[i].recordedAt)<=Date.parse(wire[i+1].time)));
 const intervals=matched?wire.map((w,i)=>({wireTime:w.time,usageRecordedAt:usage[i].recordedAt,durationMs:Date.parse(usage[i].recordedAt)-Date.parse(w.time)})):null;
 const tools=events.filter(e=>e.event.type==='tool'&&e.event.payload?.phase==='finished').map(e=>e.event.payload);
 records.push({name:row.name,arm:row.arm,durationMs:row.durationMs,administrativeInterruption:row.exit.administrativeInterruption??false,
  wireCount:wire.length,usageCount:usage.length,ordinalNonoverlapCheckPassed:matched,intervals,
  wireToUsageMs:intervals?.reduce((n,r)=>n+r.durationMs,0)??null,
  toolRecordedDurationSumMs:tools.reduce((n,t)=>n+(Number.isFinite(t.durationMs)?t.durationMs:0),0),
  toolsWithoutDuration:tools.filter(t=>!Number.isFinite(t.durationMs)).length});
}
await save(join(study,'timing-observations.json'),{complete:analysis.rows.length===protocol.order.length,
 method:'Pair serialized wire observations and usage events by ordinal only when counts and temporal non-overlap agree. This is descriptive, without provider request-ID joins. Intervals include model/provider/network and SDK reporting delay; they do not identify reasoning compute alone. Sum of tool durations can overlap other tools/background commands and is not a wall-time partition. No imputation for unmatched sequences or missing final trial duration. Interrupted partial intervals are not complete-trial measurements.',records});
console.log(JSON.stringify({records:records.length,matched:records.filter(r=>r.ordinalNonoverlapCheckPassed).length}));
