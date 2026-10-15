// Independent authored positive/negative controls, never recovered into trials.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,study} from './paths.mjs';
const p=JSON.parse(await readFile(join(study,'protocol.json'))),rows=[],sha=b=>createHash('sha256').update(b).digest('hex');
const replace=(s,a,b)=>{assert.equal(s.split(a).length,2,a);return s.replace(a,b);};
function positive(source,task){
 if(task.kind==='iterator-own-mode')for(const [name,own]of [['forIn','forOwn'],['forInRight','forOwnRight']])
  source=replace(source,`function ${name}(object, iteratee) {`,`function ${name}(object, iteratee, options) {\n      if (options && options.own === true) { return ${own}(object, iteratee); }`);
 else{
  source=replace(source,'function omitBy(object, predicate) {','function omitBy(object, predicate, options) {');
  source=replace(source,'return pickBy(object, negate(getIteratee(predicate)));','return pickBy(object, negate(getIteratee(predicate)), options);');
  source=replace(source,'function pickBy(object, predicate) {','function pickBy(object, predicate, options) {');
  source=replace(source,'var props = arrayMap(getAllKeysIn(object), function(prop) {',
   'var props = arrayMap(arrayFilter(getAllKeysIn(object), function(prop) {\n        return !options || options.ownOnly !== true || hasOwnProperty.call(object, prop);\n      }), function(prop) {');
 }return source;
}
function run(argv,cwd){const start=performance.now(),r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,TZ:'UTC'}});
 return {argv,exitCode:r.status,signal:r.signal,error:r.error?.code??null,durationMs:performance.now()-start,stdout:r.stdout,stderr:r.stderr};}
for(const task of p.tasks){
 const root=await mkdtemp(join(tmpdir(),'phrase-task-control-'));
 try{
  execFileSync(process.execPath,[join(repo,'tools/terminal_bench/phrase-study/run.mjs'),'prepare','f29',root,task.id],{cwd:repo,stdio:'pipe'});
  const feature=()=>run([process.execPath,join(repo,'tools/terminal_bench/phrase-study/features.mjs'),root,task.id,study],repo);
  const negative={feature:feature(),selected:run(task.verifierCommands.selected,root)};
  assert.equal(negative.feature.exitCode,1);assert.equal(negative.selected.exitCode,1);
  const before=await readFile(join(root,'lodash.js'),'utf8'),after=positive(before,task);await writeFile(join(root,'lodash.js'),after);
  const pass={feature:feature(),selected:run(task.verifierCommands.selected,root),syntax:run(task.verifierCommands.types,root),full:run(task.verifierCommands.full,root)};
  for(const invocation of Object.values(pass))assert.equal(invocation.exitCode,0,invocation.stderr+'\n'+invocation.stdout.slice(-4000));
  assert.match(pass.full.stdout,/PASS:\s*6794\s+FAIL:\s*0\s+TOTAL:\s*6794/u);
  const [path,text]=Object.entries(task.inputFiles)[0];await writeFile(join(root,path),text+'\n// forbidden protected-fixture change\n');
  const protectedNegative=feature();assert.equal(protectedNegative.exitCode,1);
  const checks=JSON.parse(protectedNegative.stdout).checks;assert(checks.some(c=>c.name.startsWith('protected-input:')&&!c.passed));
  assert(checks.filter(c=>!c.name.startsWith('protected-input:')).every(c=>c.passed));
  rows.push({id:task.id,originalSourceSha256:sha(before),authoredPositiveSourceSha256:sha(after),negative,positive:pass,protectedNegative});
 }finally{await rm(root,{recursive:true,force:true});}
}
await writeFile(join(study,'task-controls.json'),JSON.stringify({paidRequests:0,method:'Unchanged-input negatives,independently authored positives and protected-input negative. No model source repair or oracle feedback.',rows},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,tasks:rows.length,allExpectedControlsPass:true}));
