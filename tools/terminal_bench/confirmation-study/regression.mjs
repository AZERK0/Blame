import assert from 'node:assert/strict';import {test} from 'node:test';import {readFile} from 'node:fs/promises';
const {project}=JSON.parse(await readFile(new URL('./task.json',import.meta.url),'utf8'));
const x=await import(project==='valibot'?'../library/src/index.ts':'../packages/remeda/src/index.ts');
if(project==='valibot'){
 test('successful object transforms and defaults',()=>{assert.deepEqual(x.parse(x.object({name:x.pipe(x.string(),x.trim()),age:x.optional(x.number(),18)}),{name:' A '}),{name:'A',age:18});});
 test('custom errors and abort counts',()=>{const s=x.object({a:x.string('a'),b:x.number('b')});assert.equal(x.safeParse(s,{a:1,b:'x'}).issues.length,2);assert.equal(x.safeParse(s,{a:1,b:'x'},{abortEarly:true}).issues.length,1);});
 test('sync and async fallback old interface',async()=>{assert.equal(x.parse(x.fallback(x.string(),'ok'),0),'ok');assert.equal(await x.parseAsync(x.fallbackAsync(x.string(),async()=>'ok'),0),'ok');});
 test('config reset, unions and nested issue path',()=>{x.setGlobalConfig({lang:'fr'});assert.equal(x.safeParse(x.string(),0).issues[0].lang,'fr');x.deleteGlobalConfig();assert.equal(x.safeParse(x.string(),0).issues[0].lang,undefined);assert.equal(x.parse(x.union([x.string(),x.number()]),7),7);assert.equal(x.safeParse(x.object({a:x.string()}),{a:1}).issues[0].path[0].key,'a');});
}else{
 test('arithmetic and bigint legacy behavior',()=>{assert.equal(x.sum([1,2,3]),6);assert.equal(x.sumBy([1n,2n],n=>n),3n);assert.equal(x.mean([1,2,3]),2);assert.equal(x.meanBy([1,2,3],n=>n),2);});
 test('grouping counting and indexing normal keys',()=>{assert.deepEqual(x.groupBy([1,2,3],n=>n%2),{0:[2],1:[1,3]});assert.deepEqual(x.countBy([1,2,3],n=>n%2),{0:1,1:2});assert.deepEqual(x.indexBy([1,2,3],n=>n%2),{0:2,1:3});});
 test('lazy pipeline preserves transforms and truncation',()=>{assert.deepEqual(x.pipe([1,2,3,4],x.map(n=>n*2),x.filter(n=>n>2),x.take(2)),[4,6]);assert.deepEqual(x.zip([1,2],[3]),[[1,3]]);assert.deepEqual(x.zipWith([1,2],[3],(a,b)=>a+b),[4]);});
 test('unique and immutable arrays',()=>{const a=Object.freeze([1,2,1]);assert.deepEqual(x.unique(a),[1,2]);assert.deepEqual(x.reverse(a),[1,2,1]);assert.deepEqual(a,[1,2,1]);});
}
