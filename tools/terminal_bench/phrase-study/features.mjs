// Independent task assertions; never copied into or fed back to model workspaces.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {identifierTokens} from '../corpus/identifier-token-audit.mjs';
import {repo} from './paths.mjs';
const [workspace,id,study]=process.argv.slice(2),protocol=JSON.parse(await readFile(join(study,'protocol.json'))),task=protocol.tasks.find(t=>t.id===id);
if(!task)throw Error('Unknown task');
const require=createRequire(join(repo,'packages/agent-runtime/package.json')),ts=require('typescript'),checks=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
function check(name,run){try{run();checks.push({name,passed:true});}catch(error){checks.push({name,passed:false,error:error.message});}}
function outside(text){
 const source=ts.createSourceFile('lodash.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),ranges=[],found={};
 assert.equal(source.parseDiagnostics.length,0);
 function visit(node){if(ts.isFunctionDeclaration(node)&&node.body&&task.mutableFunctions['lodash.js'].includes(node.name?.text)){
  found[node.name.text]=(found[node.name.text]??0)+1;ranges.push([node.getStart(source),node.end]);
 }ts.forEachChild(node,visit);}visit(source);
 for(const name of task.mutableFunctions['lodash.js'])assert.equal(found[name],1,name);
 for(const [a,b]of ranges.sort((a,b)=>b[0]-a[0]))text=text.slice(0,a)+' '+text.slice(b);
 return identifierTokens(text);
}
const upstream=join(repo,protocol.upstreams.lodash.sourceRoot),original=await readFile(join(upstream,'lodash.js'),'utf8'),actual=await readFile(join(workspace,'lodash.js'),'utf8');
assert.equal(sha(original),task.selectedSourceSha256['lodash.js']);
check('source-integrity:lodash.js',()=>assert.deepEqual(outside(actual),outside(original)));
for(const [path,text]of Object.entries(task.inputFiles))check('protected-input:'+path,()=>assert.equal(require('node:fs').readFileSync(join(workspace,path),'utf8'),text));
const _=require(join(workspace,'lodash.js')),reference=require(join(upstream,'lodash.js')),own=Object.prototype.hasOwnProperty;
if(task.kind==='iterator-own-mode'){
 const trace=(lib,name,o,option,stop)=>{const seen=[],result=lib[name](o,(v,k,x)=>{seen.push([k,v,x===o]);return stop?false:undefined;},option);assert.equal(result,o);return seen;};
 const sparse=Array(4);sparse[2]=7;sparse.extra=8;
 const objects=[Object.assign(Object.create({p:3,q:4}),{a:1,b:2}),Object.assign(Object.create(null),{a:1}),null,undefined,0,false,42,'hi',[3,4],sparse];
 for(const name of ['forIn','forInRight']){
  const target=name==='forIn'?'forOwn':'forOwnRight';
  objects.forEach((o,index)=>{
   check(`${name}:own:${index}`,()=>assert.deepEqual(trace(_,name,o,{own:true}),trace(reference,target,o)));
   check(`${name}:early-false:${index}`,()=>assert.deepEqual(trace(_,name,o,{own:true},true),trace(reference,target,o,undefined,true)));
   check(`${name}:defaults:${index}`,()=>{for(const flag of [undefined,null,false,{}, {own:false},{own:1},{own:'true'}])assert.deepEqual(trace(_,name,o,flag),trace(reference,name,o));});
  });
  check(name+':throw-and-no-mutation',()=>{const o=Object.assign(Object.create({p:3}),{a:1}),e=new Error('iteratee');assert.throws(()=>_[name](o,()=>{throw e;},{own:true}),x=>x===e);assert.deepEqual(Reflect.ownKeys(o),['a']);});
 }
}else if(task.kind==='predicate-own-filter'){
 const symbol=Symbol('own'),inherited=Symbol('inherited'),hidden=Symbol('hidden');
 const object=Object.assign(Object.create({p:3,q:4,[inherited]:5}),{a:1,b:2,[symbol]:6});Object.defineProperty(object,hidden,{value:7});Object.defineProperty(object,'hidden',{value:8});
 const sparse=Array(4);sparse[2]=7;sparse.extra=8;
 const objects=[object,Object.assign(Object.create(null),{a:1}),null,undefined,0,false,42,'hi',[3,4],sparse];
 const predicates=[undefined,()=>true,()=>false,v=>typeof v==='number'&&v%2, 'active',['active',true]];
 for(const name of ['pickBy','omitBy'])objects.forEach((o,index)=>{
  predicates.forEach((predicate,p)=>{
   const fn=reference.iteratee(predicate),expected=reference.pickBy(o,(v,k)=>own.call(o,k)&&(name==='pickBy'?fn(v,k):!fn(v,k)));
   check(`${name}:own:${index}:${p}`,()=>assert.deepEqual(_[name](o,predicate,{ownOnly:true}),expected));
   check(`${name}:defaults:${index}:${p}`,()=>{for(const flag of [undefined,null,false,{}, {ownOnly:false},{ownOnly:1},{ownOnly:'true'}])assert.deepEqual(_[name](o,predicate,flag),reference[name](o,predicate));});
  });
 });
 for(const name of ['pickBy','omitBy'])check(name+':predicate-never-sees-inherited',()=>{const seen=[];_[name](object,(v,k)=>{seen.push(k);assert(own.call(object,k));return false;},{ownOnly:true});assert.deepEqual(seen,['a','b',symbol]);});
 check('predicate-shorthand-object-values',()=>{const o=Object.assign(Object.create({p:{active:true}}),{a:{active:true},b:{active:false}});assert.deepEqual(_.pickBy(o,'active',{ownOnly:true}),{a:o.a});assert.deepEqual(_.omitBy(o,['active',true],{ownOnly:true}),{b:o.b});});
}else throw Error('Unknown criteria kind');
console.log(JSON.stringify({checks}));if(checks.some(c=>!c.passed))process.exitCode=1;
