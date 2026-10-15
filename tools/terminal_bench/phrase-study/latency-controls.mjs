// Local search latency only; serial balanced order, no model or billing estimate.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,platform,arch} from 'node:os';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[];
const source=await readFile(join(repo,'.blame/research/scope-followup/upstreams/lodash/lodash.js'));
const roots={},workspaces={},bindings={};
const previous=process.env.BLAME_RIPGREP_COMMAND,startedAtUTC=new Date().toISOString();
try {
 for(const arm of ['baseline','candidate']){
  const runtime=join(work,'frozen/f29',arm,'agent-runtime/dist/harness');
  bindings[arm]=Object.fromEntries(await Promise.all(['light-workspace.js','light-navigation.js'].map(async f=>[f,sha(await readFile(join(runtime,f)))])));
  const {LightWorkspace}=await import(join(runtime,'light-workspace.js'));
  roots[arm]=await mkdtemp(join(tmpdir(),'phrase-latency-'));
  await writeFile(join(roots[arm],'lodash.js'),source);
  workspaces[arm]=new LightWorkspace(roots[arm],{sessionId:'phrase-latency'});
 }
 for(const engine of ['ripgrep','node']){
  if(engine==='node')process.env.BLAME_RIPGREP_COMMAND=join(roots.baseline,'missing-rg');
  else if(previous===undefined)delete process.env.BLAME_RIPGREP_COMMAND;
  else process.env.BLAME_RIPGREP_COMMAND=previous;
  for(let repetition=0;repetition<10;repetition++)for(const query of ['function keys','function absentDeclaration','keys']){
   for(const arm of (repetition%2?['candidate','baseline']:['baseline','candidate'])){
    const started=performance.now(),result=await workspaces[arm].searchCode({query,scope:'lodash.js',mode:'text'});
    const durationMs=performance.now()-started;
    assert.equal(result.status,'ok');assert.equal(result.data.engine,engine);
    rows.push({engine,query,arm,repetition,warmup:repetition===0,durationMs,resultCount:result.data.results.length,
     firstLine:result.data.results[0]?.lines?.[0]??null});
   }
  }
 }
 for(const arm of ['baseline','candidate'])assert.deepEqual(await readFile(join(roots[arm],'lodash.js')),source);
 const groups=[];
 for(const engine of ['ripgrep','node'])for(const query of ['function keys','function absentDeclaration','keys'])for(const arm of ['baseline','candidate']){
  const values=rows.filter(r=>r.engine===engine&&r.query===query&&r.arm===arm&&!r.warmup).map(r=>r.durationMs).sort((a,b)=>a-b);
  groups.push({engine,query,arm,n:values.length,medianMs:values[Math.floor(values.length/2)],minimumMs:values[0],maximumMs:values.at(-1)});
 }
 await writeFile(join(study,'latency-controls.json'),JSON.stringify({paidRequests:0,startedAtUTC,finishedAtUTC:new Date().toISOString(),
  method:'Balanced serial local API timing,10 rounds including retained first-round warmup; same unchanged Lodash source. Shared host and reused workspace/OS caches; not provider latency,model efficiency or independent tasks.',
  environment:{node:process.version,platform:platform(),arch:arch()},sourceSha256:sha(source),bindings,rows,groups},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({paidRequests:0,calls:rows.length,groups}));
}finally{
 if(previous===undefined)delete process.env.BLAME_RIPGREP_COMMAND;else process.env.BLAME_RIPGREP_COMMAND=previous;
 for(const root of Object.values(roots))await rm(root,{recursive:true,force:true});
}
