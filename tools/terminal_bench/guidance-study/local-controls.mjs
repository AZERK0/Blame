// Local positives/negatives are private fixtures, never agent input repairs.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {repo,study,work} from './paths.mjs';
import {bindingOracle,applyOracle} from '../navigation-evidence/multifile-criteria.mjs';
const protocol=JSON.parse(await readFile(join(study,'protocol.json')));
const ts=createRequire(join(repo,'packages/agent-runtime/package.json'))('typescript');
const sha=x=>createHash('sha256').update(x).digest('hex');
const run=(...args)=>execFileSync(process.execPath,[join(repo,'tools/terminal_bench/guidance-study/run.mjs'),...args],{cwd:repo,stdio:'inherit'});
if(process.argv[2]==='oracles'){
 assert.equal(protocol.status,'selected-before-local-controls-no-model-dispatch');
 for(const task of protocol.tasks){
  const root=join(repo,protocol.upstreams[task.project].sourceRoot);
  if(task.kind==='multifile-rename'){task.oracle=bindingOracle(root,task);task.allowedPaths=Object.keys(task.oracle.spans);assert(task.allowedPaths.length>=2);}
  task.selectedSourceSha256={};for(const path of task.allowedPaths)if(!task.inputFiles?.[path])task.selectedSourceSha256[path]=sha(await readFile(join(root,path)));
 }
 await writeFile(join(study,'protocol.json'),JSON.stringify(protocol,null,2)+'\n');
 console.log(JSON.stringify(protocol.tasks.map(t=>({id:t.id,files:t.allowedPaths.length,spans:t.oracle?Object.values(t.oracle.spans).flat().length:null}))));
}else if(process.argv[2]==='tasks'){
 const root=join(work,'task-controls-async');await mkdir(root,{recursive:true});
 const rows=[];
 for(const task of protocol.tasks){
  const workspace=join(root,task.id);
  const exists=await readFile(join(workspace,'package.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
  if(!exists)run('prepare','f28',workspace,task.id);
  function record(state,score){
   rows.push({id:task.id,state,success:score.independentFunctionalSuccess,featureFailures:score.featureChecks.filter(c=>!c.passed),exits:{selected:score.selected.exitCode,types:score.types.exitCode,full:score.full.exitCode}});
   assert.equal(score.independentFunctionalSuccess,state==='private-positive',JSON.stringify(rows.at(-1)));
   if(task.kind==='promise-abort' && state==='unchanged'){assert(score.selected.exitCode>0);assert.match(score.selected.stdout,/4 failing/u);assert(!score.selected.stderr.includes('UnhandledPromiseRejection'));}
  }
  for(const state of ['unchanged','private-positive','protected-input-negative']){
   const output=join(root,task.id+'-'+state);
   const previous=await readFile(join(output,'score.json')).then(JSON.parse,error=>{if(error.code==='ENOENT')return null;throw error;});
   if(previous){record(state,previous);continue;}
   if(state==='private-positive'){
    if(task.kind==='multifile-rename')for(const path of task.allowedPaths){const text=await readFile(join(workspace,path),'utf8');await writeFile(join(workspace,path),applyOracle(text,task.oracle.spans[path]??[],task.newName));}
    if(task.kind==='own-symbol-options'){
     const path=join(workspace,'lodash.js');let text=await readFile(path,'utf8');
     text=text.replace('function keys(object) {\n      return isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);\n    }','function keys(object, options) {\n      var result = isArrayLike(object) ? arrayLikeKeys(object) : baseKeys(object);\n      return options && options.symbols === true ? arrayPush(result, getSymbols(object)) : result;\n    }')
      .replace('function values(object) {\n      return object == null ? [] : baseValues(object, keys(object));\n    }','function values(object, options) {\n      return object == null ? [] : baseValues(object, keys(object, options));\n    }');await writeFile(path,text);
    }
    if(task.kind==='promise-abort')for(const [file,config,name,first]of [['firstValueFrom.ts','FirstValueFromConfig','firstValueFrom',true],['lastValueFrom.ts','LastValueFromConfig','lastValueFrom',false]]){
     const path=join(workspace,'src/internal',file);let text=await readFile(path,'utf8');
     const parsed=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),fn=parsed.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name&&n.body);
     const body=`{\n  const hasConfig = typeof config === 'object';\n  return new Promise<T | D>((resolve, reject) => {\n    const signal = config?.signal;\n    const abortError = () => { const error = new Error('aborted'); error.name = 'AbortError'; return error; };\n    if (signal?.aborted) { reject(abortError()); return; }\n    let seen = false; let last: T;\n    const subscriber = new SafeSubscriber<T>({\n      next: value => { seen = true; last = value; ${first?'resolve(value); subscriber.unsubscribe();':''} },\n      error: reject,\n      complete: () => { if (seen) resolve(last); else if (hasConfig) resolve(config!.defaultValue); else reject(new EmptyError()); }\n    });\n    const onAbort = () => { reject(abortError()); subscriber.unsubscribe(); };\n    subscriber.add(() => signal?.removeEventListener('abort', onAbort));\n    signal?.addEventListener('abort', onAbort, { once: true });\n    source.subscribe(subscriber);\n  });\n}`;
     text=text.slice(0,fn.body.getStart(parsed))+body+text.slice(fn.body.end);
     text=text.replace(`export interface ${config}<T> {`,`export interface ${config}<T> {\n  signal?: AbortSignal;`);
     if(!first)text="import { SafeSubscriber } from './Subscriber';\n"+text;
     await writeFile(path,text);
    }
   }
   if(state==='protected-input-negative'){
    const path=Object.keys(task.inputFiles)[0];await writeFile(join(workspace,path),(await readFile(join(workspace,path),'utf8'))+'\n// Unauthorized protected input edit\n');
   }
   run('score','f28',output,workspace,task.id);
   record(state,JSON.parse(await readFile(join(output,'score.json'))));
  }
 }
 await writeFile(join(study,'task-controls.json'),JSON.stringify({paidRequests:0,rows},null,2)+'\n');
 console.log(JSON.stringify({controls:rows.length,paidRequests:0}));
}else if(process.argv[2]==='isolation'){
 const files=async arm=>{const root=join(work,'frozen/f28',arm,'agent-runtime/dist');return Object.fromEntries(await Promise.all((await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(async e=>{const path=join(e.parentPath??e.path,e.name);return [path.slice(root.length+1),sha(await readFile(path))];})));};
 const before=await files('baseline'),rows=[];
 for(const arm of protocol.lightArms.filter(a=>a!=='baseline')){
  const after=await files(arm),changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(path=>before[path]!==after[path]);
  const meaningful=changed.filter(path=>path.endsWith('.js')||path.endsWith('.txt'));
  const version=JSON.parse(await readFile(join(work,'frozen/f28',arm,'version.json')));
  if(arm!=='bundle')for(const path of meaningful)assert(version.changedPaths.includes('src/'+path.replace(/\.js$/u,'.ts')),arm+':unregistered change '+path);
  assert(meaningful.length>0);rows.push({arm,changedFiles:changed,meaningful});
 }
 await writeFile(join(study,'isolation-controls.json'),JSON.stringify({paidRequests:0,rows},null,2)+'\n');
 console.log(JSON.stringify({isolatedVariants:rows.length,paidRequests:0}));
}else throw Error('Use oracles|tasks|isolation');
