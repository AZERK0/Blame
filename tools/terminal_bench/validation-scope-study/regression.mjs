import assert from 'node:assert/strict';import test from 'node:test';import {readFile} from 'node:fs/promises';
const {project}=JSON.parse(await readFile(new URL('./task.json',import.meta.url),'utf8'));
const api=await import(project==='valibot'?'../library/src/index.ts':'../packages/remeda/src/index.ts');
if(project==='valibot'){
 test('sync and async parser factories retain successful outputs',async()=>{const schema=api.pipe(api.string(),api.transform(x=>x.length));assert.equal(api.parser(schema)('abc'),3);assert.equal(await api.parserAsync(schema)('abcd'),4);});
 test('safe parser factories retain failure result shape',async()=>{assert.equal(api.safeParser(api.string())(1).success,false);assert.equal((await api.safeParserAsync(api.string())(1)).success,false);});
 test('root issues retain the original default summary',()=>{const result=api.safeParse(api.string('invalid'),123);assert.equal(api.summarize(result.issues),'× invalid');});
 test('unrelated transformations and object output remain intact',()=>assert.deepEqual(api.parse(api.object({x:api.pipe(api.string(),api.transform(x=>x.length))}),{x:'abc'}),{x:3}));
}else{
 test('integer take works directly and in a pipeline',()=>{assert.deepEqual(api.take([1,2,3],2),[1,2]);assert.deepEqual(api.pipe([1,2,3],api.map(x=>x*2),api.take(2)),[2,4]);});
 test('empty and negative take results remain empty',()=>{assert.deepEqual(api.take([],2),[]);assert.deepEqual(api.take([1],-1),[]);});
 test('integer take stops the upstream mapper early',()=>{let calls=0;api.pipe([1,2,3],api.map(x=>{calls++;return x;}),api.take(1));assert.equal(calls,1);});
 test('unrelated array APIs retain behavior',()=>{assert.deepEqual(api.drop([1,2,3],1),[2,3]);assert.deepEqual(api.splitAt([1,2,3],-1),[[1,2],[3]]);});
}
