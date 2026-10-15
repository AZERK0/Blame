// Diagnostic-derived prototype, separate from every frozen F28 treatment.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work} from '../guidance-study/paths.mjs';
const study=join(repo,'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15');await mkdir(study,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex'),rows=[],real=[];
const decoys=Array.from({length:50},(_,i)=>`function decoy${i}() { return ${i}; }\n`).join('');
const cases=[
 {id:'late-phrase',files:{'source.js':decoys+'function needleTarget() { return 1; }\n'},query:'function needleTarget',scope:'source.js'},
 {id:'or-fallback',files:{'a.js':'const alphaOnly = 1;\n','b.js':'const betaOnly = 2;\n'},query:'alphaOnly betaOnly'},
 {id:'literal-punctuation',files:{'source.js':'callback(item);\n'.repeat(50)+'call(item);\n'},query:'call(item) absent',scope:'source.js'},
 {id:'scope',files:{'source.js':decoys+'function needleTarget() { return 1; }\n','outside.js':'function needleTarget() { return 9; }\n'},query:'function needleTarget',scope:'source.js'},
];
const runtimes={baseline:join(work,'frozen/f28/bundle/agent-runtime/dist/harness'),candidate:join(work,'sources/phrase-prototype/packages/agent-runtime/dist/harness')};
const startedAtUTC=new Date().toISOString();
for(const [arm,runtime]of Object.entries(runtimes)){
 const {LightWorkspace}=await import(join(runtime,'light-workspace.js'));
 for(const engine of ['ripgrep','node'])for(const c of cases){
  const root=await mkdtemp(join(tmpdir(),'phrase-control-')),previous=process.env.BLAME_RIPGREP_COMMAND;
  try{
   if(engine==='node')process.env.BLAME_RIPGREP_COMMAND=join(root,'missing-rg');
   for(const [path,content]of Object.entries(c.files))await writeFile(join(root,path),content);
   const workspace=new LightWorkspace(root,{sessionId:'phrase-control'});
   const result=await workspace.searchCode({query:c.query,scope:c.scope,mode:'text'});assert.equal(result.status,'ok');
   const matches=result.data.results;assert.equal(result.data.engine,engine);
   if(c.id==='or-fallback')assert.deepEqual(matches.map(r=>r.path).sort(),['a.js','b.js']);
   if(c.id==='literal-punctuation'){assert.equal(matches.length,1);assert.equal(matches[0].snippet,'call(item);');}
   if(c.id==='scope')assert(matches.every(r=>r.path==='source.js'));
   if(['late-phrase','scope'].includes(c.id))assert.equal(matches[0].lines[0]===51,arm==='candidate');
   let authority;
   if(c.id==='late-phrase'){
    const original=await readFile(join(root,'source.js'));
    const input={operations:[{kind:'symbol',target:'source.js#needleTarget',action:'replace_body',content:'return 2;'}]};
    const blocked=await workspace.editCode(input);assert.equal(blocked.status,'blocked');assert.deepEqual(await readFile(join(root,'source.js')),original);
    assert.equal((await workspace.readCode({target:'source.js#needleTarget'},{})).status,'ok');
    assert.equal((await workspace.editCode(input)).status,'ok');
    authority={discoveryAlone:'blocked',sourceUnchangedBeforeRead:true,explicitReadThenEdit:'ok'};
   }
   rows.push({arm,engine,id:c.id,input:{query:c.query,scope:c.scope,mode:'text'},result,...(authority?{authority}:{})});
  }finally{if(previous===undefined)delete process.env.BLAME_RIPGREP_COMMAND;else process.env.BLAME_RIPGREP_COMMAND=previous;await rm(root,{recursive:true,force:true});}
 }
 for(const engine of ['ripgrep','node']){
  const root=await mkdtemp(join(tmpdir(),'phrase-lodash-')),previous=process.env.BLAME_RIPGREP_COMMAND;
  try{
   execFileSync(process.execPath,[join(repo,'tools/terminal_bench/guidance-study/run.mjs'),'prepare','f28',root,'lodash-own-symbol-options'],{cwd:repo,stdio:'pipe'});
   if(engine==='node')process.env.BLAME_RIPGREP_COMMAND=join(root,'missing-rg');
   const source=await readFile(join(root,'lodash.js')),workspace=new LightWorkspace(root,{sessionId:'phrase-lodash'});
   for(const name of ['keys','values']){
    const result=await workspace.searchCode({query:'function '+name,scope:'lodash.js',mode:'text'});assert.equal(result.status,'ok');
    const expected=source.toString().slice(0,source.toString().indexOf('    function '+name+'(')).split('\n').length;
    assert.equal(result.data.results[0].lines[0]===expected,arm==='candidate');
    real.push({arm,engine,query:'function '+name,sourceSha256:sha(source),expectedDeclarationLine:expected,result});
   }
   assert.deepEqual(await readFile(join(root,'lodash.js')),source);
  }finally{if(previous===undefined)delete process.env.BLAME_RIPGREP_COMMAND;else process.env.BLAME_RIPGREP_COMMAND=previous;await rm(root,{recursive:true,force:true});}
 }
}
const bindings=Object.fromEntries(await Promise.all(Object.entries(runtimes).map(async([arm,path])=>[arm,Object.fromEntries(await Promise.all(['light-workspace.js','light-navigation.js'].map(async f=>[f,sha(await readFile(join(path,f)))])))])));
const result={paidRequests:0,prototypeOnly:true,startedAtUTC,finishedAtUTC:new Date().toISOString(),baselineSourceCommit:'5f31042529dd5c633909267df27398418a49ebbd',bindings,rows,real,
 interpretation:'Known recorded Lodash queries and finite constructed local controls. This tests retrieval, OR/punctuation/scope preservation and read-before-edit authority; it does not establish model success or resource savings. Path-result precedence remains unchanged. Node fallback prioritizes a phrase within each visited file and retains its existing traversal/result bounds.'};
await writeFile(join(study,'local-controls.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,controls:rows.length,realQueries:real.length,candidateFindsLateDeclarations:true,authorityUnchanged:true}));
