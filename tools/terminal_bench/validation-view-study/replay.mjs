// Presentation replay of every recorded F31 Light validation-log pointer.
// Does not execute commands, repair sources, change observations or call a model.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
const repo=resolve(new URL('../../..',import.meta.url).pathname),work=join(repo,'.blame/research'),f31=join(repo,'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16'),study=join(repo,'docs/experiments/light-harness-validation-view-f32-2026-10-16');
const baseline=join(process.env.BLAME_VALIDATION_BASELINE_RUNTIME??join(work,'edit-boundaries-f31/frozen/f31/candidate/agent-runtime'),'dist/harness'),candidate=join(work,'validation-view-f32/candidate/agent-runtime/dist/harness');
const {boundedDiagnostic}=await import(join(baseline,'light-diagnostic.js')),{boundedValidationDiagnostic}=await import(join(candidate,'validation-output.js'));
const sha=b=>createHash('sha256').update(b).digest('hex'),json=async p=>JSON.parse(await readFile(p));
const results=await json(join(f31,'results.json')),ledger=await json(join(f31,'tool-ledger.json'));
assert.equal(results.completed,18,'Wait for the fixed model panel to finish before replay');
const publicOnly=process.argv.includes('--public-only'),rows=[];await mkdir(join(study,'logs'),{recursive:true});
const clean=s=>s.replace(/\x1b\[[0-9;]*m/gu,'').trim();
const aggregates=output=>output.split('\n').map((text,index)=>({line:index+1,text:clean(text)})).filter(({text})=>/^(?:(?:#|ℹ)\s+(?:tests|suites|pass|fail|cancelled|skipped|todo)\s+\d+\b|(?:Test Suites|Tests|Snapshots):\s|\d+\s+(?:passing|failing|pending)\b|(?:PASS|FAIL):\s*\d)/u.test(text));
const oldRender=(s,max)=>s.length<=1200?s:boundedDiagnostic(s,'',max);
const newRender=(s,max)=>s.length<=1200?s:boundedValidationDiagnostic(s,max);
// Fixed iteration count, alternating which renderer runs first per log.
const repetitions=50;
for(const trial of results.rows.filter(r=>r.arm!=='cline')){
 const tools=ledger.find(r=>r.name===trial.name).tools;
 for(const [index,t]of tools.entries()){
  if(t.tool!=='run_task')continue;
  const data=t.output?.data?.completed?.data??t.output?.data,pointer=data?.outputLog;
  if(!pointer)continue;
  assert(/^\.blame\/logs\/validation-[\w-]+\.log$/u.test(pointer));
  const artifact='logs/'+trial.name+'-'+index+'.log.gz';let bytes;
  if(publicOnly)bytes=gunzipSync(await readFile(join(study,artifact)));
  else{
   try{bytes=await readFile(join(work,'edit-boundaries-f31/f31',trial.name,'workspace',pointer));}
   catch(error){if(error.code!=='ENOENT')throw error;rows.push({name:trial.name,index,pointer,missing:true,eventsSha256:trial.eventsSha256});continue;}
   await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}));
  }
  const raw=bytes.toString(),maximum=data.failure||(data.paths?.length??0)>0?4000:900;
  const c=data.check?.counts,caption=data.check?.evidenceOrigin==='node_events'&&c?`\nActive Node case results: ${c.passed} passed, ${c.failed} failed, ${c.skipped} skipped/todo. File workers and suites are excluded. Command outcome: ${data.check.outcome}. Test scope, selection and freshness are not admitted by these counts.`:'';
  const before=oldRender(raw,maximum)+caption,after=newRender(raw,maximum)+caption;
  assert.equal(before,data.output,'Old renderer must reproduce the exact original presentation');
  assert(after.length<=(raw.length<=1200?1200:maximum)+caption.length);
  const detected=aggregates(raw),visible=view=>detected.filter(l=>clean(view).includes(l.text));
  const baselineVisible=visible(before),candidateVisible=visible(after),gainedLines=candidateVisible.filter(l=>!baselineVisible.some(b=>b.line===l.line)),lostLines=baselineVisible.filter(l=>!candidateVisible.some(c=>c.line===l.line));
  let baselineMs=0,candidateMs=0;
  for(const r of Array.from({length:repetitions},(_,i)=>i))for(const arm of (r+index)%2?['candidate','baseline']:['baseline','candidate']){
   const start=process.cpuUsage();(arm==='baseline'?oldRender:newRender)(raw,maximum);const cpu=process.cpuUsage(start),elapsed=(cpu.user+cpu.system)/1000;
   if(arm==='baseline')baselineMs+=elapsed;else candidateMs+=elapsed;
  }
  rows.push({name:trial.name,index,pointer,artifact,eventsSha256:trial.eventsSha256,rawSha256:sha(bytes),rawBytes:bytes.length,maximum,
   originalObservationSha256:sha(JSON.stringify({check:data.check??null,reporting:data.reporting??null,validation:data.validation??null})),observationsRecomputed:false,
   detectedLines:detected,baselineVisible,candidateVisible,gainedLines,lostLines,baselineCharacters:before.length,candidateCharacters:after.length,baselineBytes:Buffer.byteLength(before),candidateBytes:Buffer.byteLength(after),
   changed:before!==after,baselineOutput:before,candidateOutput:after,renderCpuMs:{repetitions,baseline:baselineMs,candidate:candidateMs}});
 }
}
const available=rows.filter(r=>!r.missing),sum=key=>available.reduce((n,r)=>n+r[key],0);
const totals={selectedPointers:rows.length,missingLogs:rows.length-available.length,changedLogs:available.filter(r=>r.changed).length,detectedLines:available.reduce((n,r)=>n+r.detectedLines.length,0),baselineVisible:available.reduce((n,r)=>n+r.baselineVisible.length,0),candidateVisible:available.reduce((n,r)=>n+r.candidateVisible.length,0),gainedLines:available.reduce((n,r)=>n+r.gainedLines.length,0),lostLines:available.reduce((n,r)=>n+r.lostLines.length,0),baselineCharacters:sum('baselineCharacters'),candidateCharacters:sum('candidateCharacters'),baselineBytes:sum('baselineBytes'),candidateBytes:sum('candidateBytes'),renderCpuMs:{repetitions,baseline:available.reduce((n,r)=>n+r.renderCpuMs.baseline,0),candidate:available.reduce((n,r)=>n+r.renderCpuMs.candidate,0)}};
await writeFile(join(study,publicOnly?'public-replay.json':'recorded-replay.json'),JSON.stringify({paidRequests:0,modelEfficacyMeasured:false,method:'All F31 Light finished run_task outputLog pointers,including failed trials. Raw logs are already redacted by the task runner. Reproduce original presentation exactly,then render the same bytes under the same cap. Summary-line occurrences are observations,not test totals; duplicate identical text can make includes-based visibility optimistic. CPU microbenchmark is serial with fixed50 repetitions and alternating order; it is not model/worker latency.',node:process.version,resultsSha256:sha(await readFile(join(f31,'results.json'))),toolLedgerSha256:sha(await readFile(join(f31,'tool-ledger.json'))),totals,rows},null,2)+'\n');
console.log(JSON.stringify(totals));
