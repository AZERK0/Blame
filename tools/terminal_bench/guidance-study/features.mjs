// Private independent assertions. Never imported or copied into model workspaces.
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {identifierTokens} from '../corpus/identifier-token-audit.mjs';
import {auditMultifile} from '../navigation-evidence/multifile-criteria.mjs';
import {repo} from './paths.mjs';
const ts=createRequire(join(repo,'packages/agent-runtime/package.json'))('typescript');
const [workspace,id,study]=process.argv.slice(2);
const protocol=JSON.parse(await readFile(join(study,'protocol.json'))),task=protocol.tasks.find(t=>t.id===id);
if(!task)throw Error('Unknown task');
const checks=[],sha=x=>createHash('sha256').update(x).digest('hex');
function outsideMutable(text,path) {
 const file=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true),ranges=[],found={};
 if(file.parseDiagnostics.length)throw Error('Invalid source syntax');
 function visit(node){
  if(ts.isFunctionDeclaration(node)&&node.body&&task.mutableFunctions[path].includes(node.name?.text)){
   const name=node.name.text;found[name]=(found[name]??0)+1;ranges.push([node.getStart(file),node.end]);
  }
  if(task.permittedSupportingImports&&ts.isImportDeclaration(node))ranges.push([node.getStart(file),node.end]);
  if(ts.isInterfaceDeclaration(node))for(const member of node.members){
   const permission=task.permittedAuxiliaryMembers?.[path]?.[node.name.text]?.[member.name?.getText(file)];
   if(!permission)continue;
   if(!member.questionToken||member.type?.getText(file)!==permission)throw Error('Expected optional '+permission+' member');
   ranges.push([member.getStart(file),member.end]);
  }
  ts.forEachChild(node,visit);
 }visit(file);
 for(const name of task.mutableFunctions[path])if(found[name]!==1)throw Error('Missing/ambiguous implementation '+name);
 for(const [start,end]of ranges.sort((a,b)=>b[0]-a[0]))text=text.slice(0,start)+' '+text.slice(end);
 return identifierTokens(text);
}
for(const [path,hash]of Object.entries(task.selectedSourceSha256??{})) {
 const original=await readFile(join(repo,protocol.upstreams[task.project].sourceRoot,path),'utf8');
 if(sha(original)!==hash)throw Error('Original source mismatch');
 if(task.kind==='multifile-rename')continue;
 const actual=await readFile(join(workspace,path),'utf8');
 let passed=false,error;try{passed=JSON.stringify(outsideMutable(original,path))===JSON.stringify(outsideMutable(actual,path));}catch(e){error=e.message;}
 checks.push({name:'source-integrity:'+path,passed,error,sourceSha256:sha(actual)});
}
if(task.kind==='multifile-rename')checks.push(...await auditMultifile(join(repo,protocol.upstreams[task.project].sourceRoot),workspace,task));
for(const [path,text]of Object.entries(task.inputFiles??{}))if(!task.mutableInputFiles?.includes(path))
 checks.push({name:'protected-input:'+path,passed:await readFile(join(workspace,path),'utf8')===text});
if(task.kind==='own-symbol-options') {
 const require=createRequire(join(workspace,'package.json')),_=require(join(workspace,'lodash.js'));
 const equal=(a,b)=>a.length===b.length&&a.every((x,i)=>Object.is(x,b[i]));
 for(const array of [false,true])for(const enumerable of [false,true]){
  const s=Symbol('own'),inherited=Symbol('inherited'),o=array?[10,20]:{a:10,b:20};
  const proto=Object.create(Object.getPrototypeOf(o));proto[inherited]=99;Object.setPrototypeOf(o,proto);
  Object.defineProperty(o,s,{value:30,enumerable});
  const keys=[''+(array?0:'a'),''+(array?1:'b')],expected=enumerable?[...keys,s]:keys;
  checks.push({name:`own-symbols:${array}:${enumerable}`,passed:equal(_.keys(o,{symbols:true}),expected)&&equal(_.values(o,{symbols:true}),enumerable?[10,20,30]:[10,20])});
  checks.push({name:`default-symbols:${array}:${enumerable}`,passed:[undefined,null,false,{symbols:false},{symbols:1}].every(option=>equal(_.keys(o,option),keys)&&equal(_.values(o,option),[10,20]))});
 }
 checks.push({name:'primitive-and-null-defaults',passed:equal(_.keys('hi',{symbols:true}),['0','1'])&&equal(_.values('hi',{symbols:true}),['h','i'])&&[null,undefined,42,false].every(x=>_.keys(x,{symbols:true}).length===0&&_.values(x,{symbols:true}).length===0)});
}
if(task.kind==='promise-abort') {
 const require=createRequire(join(workspace,'package.json')),esbuild=require('esbuild');
 const code=esbuild.buildSync({stdin:{contents:'export {firstValueFrom,lastValueFrom,Observable,of,EMPTY,throwError} from "./src/index";',resolveDir:workspace},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'}).outputFiles[0].text;
 const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require,setTimeout,clearTimeout,setInterval,clearInterval,Promise,console,AbortController});
 const rx=module.exports;
 async function settled(p){let timer;try{return await Promise.race([p.then(value=>({state:'value',value}),error=>({state:'error',error})),new Promise(resolve=>{timer=setTimeout(()=>resolve({state:'timeout'}),150);})]);}finally{clearTimeout(timer);}}
 function tracked(){const controller=new AbortController(),signal=controller.signal,active=new Map(),add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);
  signal.addEventListener=(type,listener,options)=>{if(type!=='abort')return add(type,listener,options);const wrapped=event=>{if(options?.once)active.delete(listener);typeof listener==='function'?listener.call(signal,event):listener.handleEvent(event);};active.set(listener,wrapped);return add(type,wrapped,options);};
  signal.removeEventListener=(type,listener,options)=>{const wrapped=active.get(listener);active.delete(listener);return remove(type,wrapped??listener,options);};
  return {controller,signal,active};}
 for(const name of ['firstValueFrom','lastValueFrom']) {
  const convert=rx[name];let starts=0;
  const pre=tracked();pre.controller.abort();const a=await settled(convert(new rx.Observable(()=>{starts++;}),{defaultValue:42,signal:pre.signal}));
  checks.push({name:name+':preabort-no-subscription',passed:a.state==='error'&&a.error?.name==='AbortError'&&starts===0&&pre.active.size===0});
  let closes=0;const pending=tracked(),promise=convert(new rx.Observable(()=>()=>{closes++;}),{defaultValue:42,signal:pending.signal});pending.controller.abort();const b=await settled(promise);pending.controller.abort();
  checks.push({name:name+':pending-abort-once-cleanup',passed:b.state==='error'&&b.error?.name==='AbortError'&&closes===1&&pending.active.size===0});
  const natural=tracked(),c=await settled(convert(rx.of(1,2),{defaultValue:42,signal:natural.signal}));
  checks.push({name:name+':natural-value-and-listener-cleanup',passed:c.state==='value'&&c.value===(name==='firstValueFrom'?1:2)&&natural.active.size===0});
  const empty=tracked(),d=await settled(convert(rx.EMPTY,{defaultValue:42,signal:empty.signal}));
  checks.push({name:name+':default-and-listener-cleanup',passed:d.state==='value'&&d.value===42&&empty.active.size===0});
  const failure=tracked(),error=new Error('source failure'),e=await settled(convert(rx.throwError(()=>error),{defaultValue:42,signal:failure.signal}));
  checks.push({name:name+':source-error-and-listener-cleanup',passed:e.state==='error'&&e.error===error&&failure.active.size===0});
  const synchronous=tracked();let teardown=0;const f=await settled(convert(new rx.Observable(subscriber=>{synchronous.controller.abort();subscriber.next(7);return()=>{teardown++;};}),{defaultValue:42,signal:synchronous.signal}));
  checks.push({name:name+':synchronous-abort-no-tdz',passed:f.state==='error'&&f.error?.name==='AbortError'&&teardown===1&&synchronous.active.size===0});
 }
}
console.log(JSON.stringify({checks}));if(checks.some(check=>!check.passed))process.exitCode=1;
