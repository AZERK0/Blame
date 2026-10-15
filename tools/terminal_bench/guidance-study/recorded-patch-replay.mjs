// Replay one recorded pre-edit prefix in separate pristine workspaces.
// No model request, trial mutation, reference-solution recovery or feedback.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const name='1-rxjs-promise-abort-config-baseline',sha=b=>createHash('sha256').update(b).digest('hex');
const raw=await readFile(join(work,'f28',name,'events.jsonl'),'utf8');
const tools=raw.trim().split('\n').map(s=>JSON.parse(s).event).filter(e=>e.type==='tool'&&e.payload?.phase==='finished')
 .map(e=>({tool:e.payload.toolCall?.name??e.payload.tool,input:e.payload.toolCall?.input??e.payload.input,output:e.payload.output}));
assert.equal(tools[12].tool,'edit_code');assert.equal(tools[12].output.status,'blocked');
const rows=[];
for(const arm of ['baseline','patch']){
 const root=await mkdtemp(join(work,'recorded-patch-'+arm+'-'));
 try{
  execFileSync(process.execPath,[join(repo,'tools/terminal_bench/guidance-study/run.mjs'),'prepare','f28',root,'rxjs-promise-abort-config'],{cwd:repo,stdio:'pipe'});
  const {LightWorkspace}=await import(join(work,'frozen/f28',arm,'agent-runtime/dist/harness/light-workspace.js'));
  const workspace=new LightWorkspace(root,{sessionId:'recorded-patch-replay'});
  for(const t of tools.slice(0,12)){
   assert(['read_code','search_code'].includes(t.tool));
   const result=t.tool==='read_code'?await workspace.readCode(t.input,{}):await workspace.searchCode(t.input);
   assert.equal(result.status,t.output.status);
  }
  const files=['src/internal/firstValueFrom.ts','src/internal/lastValueFrom.ts'];
  const hashes=async()=>Object.fromEntries(await Promise.all(files.map(async f=>[f,sha(await readFile(join(root,f)))])));
  const before=await hashes(),rejected=await workspace.editCode(tools[12].input);
  assert.equal(rejected.status,'blocked');assert.deepEqual(await hashes(),before);
  assert.equal(String(rejected.recovery).includes('"patchCorrection"'),arm==='patch');
  // Explicit caller choice of the suggested deliberate file-patch route.
  const recoveryInput=structuredClone(tools[12].input);for(const op of recoveryInput.operations)delete op.target;
  const recovered=await workspace.editCode(recoveryInput);assert.equal(recovered.status,'ok');
  const after=await hashes();assert.notDeepEqual(after,before);
  rows.push({arm,before,rejected,recoveryInputSha256:sha(JSON.stringify(recoveryInput)),
   recoveredStatus:recovered.status,changedPaths:recovered.data.changes.map(c=>c.path).sort(),after});
 }finally{await rm(root,{recursive:true,force:true});}
}
assert.deepEqual(rows[0].after,rows[1].after);
const result={paidRequests:0,trialSource:name,eventsSha256:sha(raw),recordedPrefixCalls:12,recordedRejectedCall:12,rows,
 conclusion:'Both frozen versions reject the original multi-file symbol-scoped request atomically and support an explicit file-patch retry. The patch-only version adds the precise shape correction and two routes. The recorded baseline agent already recovered; this replay demonstrates clearer feedback, not a new success or proven model resource gain.'};
await writeFile(join(study,'recorded-patch-replay.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,rows:rows.map(({arm,recoveredStatus,changedPaths})=>({arm,recoveredStatus,changedPaths}))}));
