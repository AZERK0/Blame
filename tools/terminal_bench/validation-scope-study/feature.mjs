import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
const {id,project}=JSON.parse(await readFile(new URL('./task.json',import.meta.url),'utf8'));
const api=await import(project==='valibot'?'../library/src/index.ts':'../packages/remeda/src/index.ts');
if(id==='valibot-parser-overrides'){
 for(const name of ['parser','parserAsync','safeParser','safeParserAsync'])test(name+' merges per-call config without changing metadata',async()=>{
  const schema=api.object({a:api.string(),b:api.string()}),config=Object.freeze({abortEarly:true,message:'captured',lang:'en'}),override=Object.freeze({abortEarly:false,message:'per call',lang:'fr'});
  const parser=api[name](schema,config),input={a:1,b:2};
  async function issues(value){try{const out=await value;assert.equal(out.success,false);return out.issues;}catch(error){assert.ok(error instanceof api.ValiError);return error.issues;}}
  const invoke=async(...args)=>parser(...args);
  const old=await issues(invoke(input));assert.equal(old.length,1);assert.equal(old[0].message,'captured');
  const next=await issues(invoke(input,override));assert.equal(next.length,2);assert.ok(next.every(i=>i.message==='per call'));
  const cleared=await issues(invoke(input,{message:undefined}));assert.equal(cleared.length,1);assert.notEqual(cleared[0].message,'captured');
  assert.equal((await issues(invoke(input,undefined)))[0].message,'captured');
  assert.equal(parser.schema,schema);assert.equal(parser.config,config);assert.deepEqual(override,{abortEarly:false,message:'per call',lang:'fr'});
  const good=await parser({a:'x',b:'y'},override);assert.deepEqual(name.startsWith('safe')?good.output:good,{a:'x',b:'y'});
 });
}else if(id==='valibot-summary-format'){
 const result=api.safeParse(api.object({name:api.string('name bad'),tags:api.array(api.number('tag bad'))}),{name:12,tags:['bad']});
 assert.equal(result.success,false);const issues=result.issues;
 test('defaults and explicit undefined preserve the original summary',()=>{assert.equal(api.summarize(issues),'× name bad\n  → at name\n× tag bad\n  → at tags.0');assert.equal(api.summarize(issues,{bullet:undefined,indent:undefined,includePath:undefined}),api.summarize(issues));});
 test('custom marker and indentation retain order and dot paths',()=>assert.equal(api.summarize(issues,{bullet:'!',indent:'--'}),'! name bad\n--→ at name\n! tag bad\n--→ at tags.0'));
 test('empty strings and hidden paths are deliberate overrides',()=>{assert.equal(api.summarize(issues,{bullet:'',indent:''}),' name bad\n→ at name\n tag bad\n→ at tags.0');assert.equal(api.summarize(issues,{includePath:false}),'× name bad\n× tag bad');});
 test('formatting never changes the input issues and handles absent paths',()=>{const before=JSON.stringify(issues);api.summarize(issues,{bullet:'?',indent:'\t',includePath:false});assert.equal(JSON.stringify(issues),before);const root=api.safeParse(api.string('root bad'),123);assert.equal(api.summarize(root.issues,{bullet:'!'}),'! root bad');});
}else{
 const input=Object.freeze([1,2,3,4]);
 for(const count of [0.2,0.9,1.2,1.9,2.8,NaN,0,-0.5,-Infinity,Infinity])test('take agrees in eager/curried/lazy forms for '+String(count),()=>{
  const normalized=Number.isNaN(count)?0:Math.max(0,Math.floor(count)),expected=input.slice(0,normalized);
  assert.deepEqual(api.take(input,count),expected);assert.deepEqual(api.take(count)(input),expected);
  let calls=0;const lazy=api.pipe(input,api.map(value=>{calls++;return value;}),api.take(count));
  assert.deepEqual(lazy,expected);assert.equal(calls,expected.length);assert.deepEqual(input,[1,2,3,4]);
 });
 test('taking everything still returns a shallow copy',()=>{const result=api.take(input,Infinity);assert.notEqual(result,input);assert.deepEqual(result,input);});
}
