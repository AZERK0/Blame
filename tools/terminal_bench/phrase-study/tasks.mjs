// Task selection precedes all F29 model outcomes; no preferred search query supplied.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {repo} from '../guidance-study/paths.mjs';
const sourceRoot='.blame/research/scope-followup/upstreams/lodash';
const sha=b=>createHash('sha256').update(b).digest('hex');
const common=" Work independently in this checkout; do not retrieve published/reference solutions,remote source history,earlier benchmark artifacts or private verifier source. Do not change dependency manifests,lockfiles,configuration or assertions. Do not add files. Preserve other declarations and all original/supplied tests. Report actual command outcomes and observed test counts. Keep pending distinct from skipped; an unreported skipped category is unknown,not zero. Disclose verification limitations.";
const header="const assert=require('node:assert/strict');const {test}=require('node:test');const _=require('../lodash.js');\n";
const iteratorFixture=header+`
function trace(name,object,options,stop){const seen=[];const result=_[name](object,(v,k,o)=>{seen.push([k,v,o===object]);return stop?false:undefined;},options);assert.equal(result,object);return seen;}
test('own mode matches existing forward and reverse own iterators',()=>{const o=Object.assign(Object.create({inherited:3}),{a:1,b:2});for(const [method,own]of [['forIn','forOwn'],['forInRight','forOwnRight']])assert.deepEqual(trace(method,o,{own:true}),trace(own,o));});
test('early false preserves order and return value',()=>{const o=Object.assign(Object.create({z:3}),{a:1,b:2});for(const [method,own]of [['forIn','forOwn'],['forInRight','forOwnRight']])assert.deepEqual(trace(method,o,{own:true},true),trace(own,o,undefined,true));});
test('non-true options retain default inherited traversal',()=>{const o=Object.assign(Object.create({z:3}),{a:1,b:2});for(const name of ['forIn','forInRight'])for(const option of [undefined,null,false,{}, {own:false},{own:1},{own:'true'}]){const seen=trace(name,o,option);assert.deepEqual(seen,trace(name,o));assert(seen.some(x=>x[0]==='z'));}});
test('null primitives arrays and sparse arrays match own iterator semantics',()=>{const sparse=Array(3);sparse[1]=7;sparse.extra=8;for(const o of [null,undefined,0,false,42,'hi',[3,4],sparse,Object.assign(Object.create(null),{x:1})])for(const [method,own]of [['forIn','forOwn'],['forInRight','forOwnRight']])assert.deepEqual(trace(method,o,{own:true}),trace(own,o));});
test('enumerability and existing symbol policy are preserved',()=>{const s=Symbol(),o=Object.assign(Object.create({z:3}),{a:1,[s]:2});Object.defineProperty(o,'hidden',{value:4});for(const [method,own]of [['forIn','forOwn'],['forInRight','forOwnRight']])assert.deepEqual(trace(method,o,{own:true}),trace(own,o));});
test('callback exceptions and input identity are preserved',()=>{const o=Object.assign(Object.create({z:3}),{a:1}),error=new Error('iteratee');for(const name of ['forIn','forInRight'])assert.throws(()=>_[name](o,()=>{throw error;},{own:true}),e=>e===error);assert.deepEqual(Object.keys(o),['a']);});
`;
const predicateFixture=header+`
test('ownOnly filters inherited traversal for both predicates',()=>{const o=Object.assign(Object.create({p:3,q:4}),{a:1,b:2});assert.deepEqual(_.pickBy(o,v=>v%2,{ownOnly:true}),{a:1});assert.deepEqual(_.omitBy(o,v=>v%2,{ownOnly:true}),{b:2});});
test('own enumerable symbols remain and inherited symbols are filtered',()=>{const a=Symbol('own'),b=Symbol('inherited'),o=Object.assign(Object.create({p:3,[b]:4}),{a:1,[a]:2});Object.defineProperty(o,'hidden',{value:5});const result=_.pickBy(o,()=>true,{ownOnly:true});assert.deepEqual(Reflect.ownKeys(result),['a',a]);assert.equal(result[a],2);assert.deepEqual(Reflect.ownKeys(_.omitBy(o,()=>false,{ownOnly:true})),['a',a]);});
test('non-true options keep inherited defaults',()=>{const o=Object.assign(Object.create({p:3}),{a:1});for(const option of [undefined,null,false,{}, {ownOnly:false},{ownOnly:1},{ownOnly:'true'}]){assert.deepEqual(_.pickBy(o,()=>true,option),{a:1,p:3});assert.deepEqual(_.omitBy(o,()=>false,option),{a:1,p:3});}});
test('predicate shorthands retain their meaning',()=>{const o=Object.assign(Object.create({p:{active:true}}),{a:{active:true},b:{active:false}});assert.deepEqual(_.pickBy(o,'active',{ownOnly:true}),{a:o.a});assert.deepEqual(_.omitBy(o,['active',true],{ownOnly:true}),{b:o.b});});
test('callbacks receive own values and keys without mutating input',()=>{const o=Object.assign(Object.create({p:3}),{a:1,b:2}),seen=[];_.pickBy(o,(v,k)=>{seen.push([k,v]);return true;},{ownOnly:true});assert.deepEqual(seen,[['a',1],['b',2]]);assert.deepEqual(Object.keys(o),['a','b']);});
test('null primitives arrays and sparse own keys are handled',()=>{for(const o of [null,undefined,42,false]){assert.deepEqual(_.pickBy(o,()=>true,{ownOnly:true}),{});assert.deepEqual(_.omitBy(o,()=>false,{ownOnly:true}),{});}assert.deepEqual(_.pickBy('hi',()=>true,{ownOnly:true}),{'0':'h','1':'i'});const sparse=Array(3);sparse[1]=7;assert.deepEqual(_.pickBy(sparse,()=>true,{ownOnly:true}),{'1':7});});
`;
const selectedSourceSha256={'lodash.js':sha(await readFile(join(repo,sourceRoot,'lodash.js')))};
const definitions=[
 {id:'lodash-iterator-own-mode',kind:'iterator-own-mode',functions:['forIn','forInRight'],fixture:'test/agent-iterator-own.test.cjs',content:iteratorFixture,
  request:'Extend _.forIn(object,iteratee,options) and _.forInRight(object,iteratee,options) with optional {own:true}. With the flag exactly true, use the existing forOwn/forOwnRight enumeration behavior respectively, including ordering,early false termination,callback arguments,return identity,null/primitive/array-like handling and existing symbol policy. Preserve default inherited traversal for absent,false or non-true flags and all existing iteratee behavior. Leave forOwn/forOwnRight and unrelated APIs unchanged. Restrict implementation changes to the existing forIn and forInRight functions in lodash.js; do not add top-level declarations/helpers.'},
 {id:'lodash-predicate-own-filter',kind:'predicate-own-filter',functions:['pickBy','omitBy'],fixture:'test/agent-predicate-own.test.cjs',content:predicateFixture,
  request:'Extend _.pickBy(object,predicate,options) and _.omitBy(object,predicate,options) with optional {ownOnly:true}. With the flag exactly true, restrict the existing enumeration to keys actually owned by the input: inherited keys must not appear or reach the predicate. Preserve the existing enumerable string/symbol handling and order,callback arguments,predicate shorthands,null/primitive/array-like behavior and input contents. Synthetic sparse-array holes are not owned keys. Preserve default inherited traversal for absent,false or non-true flags. Leave unrelated APIs unchanged. Restrict implementation changes to the existing pickBy and omitBy functions in lodash.js; do not add top-level declarations/helpers.'},
];
export const tasks=definitions.map(d=>({id:d.id,project:'lodash',kind:d.kind,partition:'fresh-confirmation',allowedPaths:['lodash.js'],mutableFunctions:{'lodash.js':d.functions},selectedSourceSha256,
 inputFiles:{[d.fixture]:d.content},requiredChecks:[],selectedTests:[d.fixture],verifierCommands:{types:['node','--check','lodash.js'],selected:['node','--test',d.fixture],full:['node','test/test.js']},
 instruction:d.request+' Inspect implementation and relevant test directories.'+common+` After the final edit run exactly node --check lodash.js and node test/test.js and node --test ${d.fixture}.\n`}));
if(process.argv[2]==='select'){
 const study=join(repo,'docs/experiments/light-harness-phrase-ranking-f29-2026-10-15');
 await writeFile(join(study,'task-selection.json'),JSON.stringify({selectedAtUTC:new Date().toISOString(),paidRequests:0,
  scope:'Two fresh constructed tasks in one already-familiar monolithic project and related option-extension family; not independent external issue clusters. Earlier F28 queries are known mechanism diagnostics only.',tasks},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({paidRequests:0,tasks:tasks.map(t=>t.id)}));
}
