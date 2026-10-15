// Trace exposure is not a post-selected success filter or a causal estimate.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {study} from './paths.mjs';
const results=JSON.parse(await readFile(join(study,'results.json'))),ledger=JSON.parse(await readFile(join(study,'tool-ledger.json'))),rows=[];
for(const row of results.rows){
 const calls=ledger.find(r=>r.name===row.name).tools.filter(t=>t.tool==='edit_code');
 const operations=calls.flatMap(t=>(Array.isArray(t.input.operations)?t.input.operations:[]).map(op=>({...op,status:t.output?.status})));
 const whole=operations.filter(o=>o.kind==='symbol'&&o.action==='replace');
 rows.push({name:row.name,arm:row.arm,eventsSha256:row.eventsSha256,
  wholeSymbolAttempts:whole.length,successfulWholeSymbolOperations:whole.filter(o=>o.status==='ok').length,
  bodyOnlyAttempts:operations.filter(o=>o.kind==='symbol'&&o.action==='replace_body').length,
  fileOrScopedPatchAttempts:operations.filter(o=>o.kind==='patch').length,
  blockedEditCalls:calls.filter(t=>t.output?.status==='blocked').length,
  malformedOperationArrays:calls.filter(t=>!Array.isArray(t.input.operations)).length,
  nativePatchCalls:ledger.find(r=>r.name===row.name).tools.filter(t=>t.tool==='apply_patch').length,
  wholeInputs:whole.map(o=>({target:o.target,status:o.status,firstLineWhitespace:typeof o.content==='string'?o.content.match(/^[\t ]*/u)[0]:null})),
  firstLineNormalizationActuallyApplied:null,
  mechanismRouteAbsent:row.arm==='cline'?null:whole.every(o=>o.status!=='ok')});
}
await writeFile(join(study,'mechanism-exposure.json'),JSON.stringify({paidRequests:0,method:'Count Light edit_code symbol/body/patch operations; native apply_patch calls are separate. Positive counts do not prove that the existing prefix matched or was stripped; actual application remains unknown without a source replay. Zero successful whole-symbol operations establishes absence of this route. This is never a task-selection or acceptance filter.',rows},null,2)+'\n');
