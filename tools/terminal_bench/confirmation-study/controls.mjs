import assert from 'node:assert/strict';import {spawnSync,execFileSync} from 'node:child_process';import {readFile,writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
import {work,study,prepare,save,sourceRoot} from './setup.mjs';import {tasks} from './tasks.mjs';
async function replace(path,from,to){const text=await readFile(path,'utf8');assert.ok(text.includes(from),`Missing anchor: ${path} ${from}`);await writeFile(path,text.replaceAll(from,to));}
export async function positive(root,id){const src=join(root,sourceRoot(id.split('-')[0]));const p=(...s)=>join(src,...s);
 if(id==='valibot-message-prefix'||id==='valibot-hide-input'){
 const prefix=id==='valibot-message-prefix',key=prefix?'messagePrefix':'hideInput';
 await replace(p('types/config.ts'),'  readonly lang?: string | undefined;',`  readonly ${key}?: ${prefix?'string':'boolean'} | undefined;\n  readonly lang?: string | undefined;`);
 await replace(p('storages/globalConfig/globalConfig.ts'),'    lang: config?.lang ?? store?.lang,',`    ${key}: config?.${key} ?? store?.${key},\n    lang: config?.lang ?? store?.lang,`);
 await replace(p('utils/_addIssue/_addIssue.ts'),'  // If context is a schema, set typed to `false`',`${prefix?"  Object.assign(issue, { message: (config.messagePrefix ?? '') + issue.message });":"  if (config.hideInput) Object.assign(issue, { input: undefined });"}\n\n  // If context is a schema, set typed to \`false\``);
 }else if(id==='valibot-fallback-when'){
 for(const name of ['fallback','fallbackAsync']){
 const async=name==='fallbackAsync'; const f=p('methods/fallback',name+'.ts');
 await replace(f,'  fallback: TFallback\n)',`  fallback: TFallback,\n  when?: (dataset: OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>, config: Config<InferIssue<TSchema>>) => ${async?'boolean | Promise<boolean>':'boolean'}\n)`);
 await replace(f,'      return outputDataset.issues','      return outputDataset.issues && (!when || '+(async?'await ':'')+'when(outputDataset, config))');
 }
 }else if(id==='remeda-stable-sum'){
 await writeFile(p('internal/stableSum.ts'),`export function stableSum(values: Iterable<number | bigint>): number | bigint {
 let total: number | bigint = 0, correction = 0, first = true;
 for (const value of values) {
  if (first) { total = typeof value === 'bigint' ? 0n : 0; first = false; }
  if (typeof total === 'bigint' && typeof value === 'bigint') { total += value; continue; }
  if (typeof total !== 'number' || typeof value !== 'number') throw new TypeError('Mixed numeric types');
  const next: number = total + value;
  if (Number.isFinite(next) && Number.isFinite(total) && Number.isFinite(value)) correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
  else correction = 0;
  total = next;
 }
 return typeof total === 'bigint' ? total : total + correction;
}\n`);
 const sum=p('sum.ts');let text=await readFile(sum,'utf8');text='import { stableSum } from "./internal/stableSum";\n'+text;const start=text.indexOf('  // eslint-disable-next-line',text.indexOf('function sumImplementation'));text=text.slice(0,start)+'  return stableSum(data) as T[number];\n}\n';await writeFile(sum,text);
 const sumBy=p('sumBy.ts');text=await readFile(sumBy,'utf8');text='import { stableSum } from "./internal/stableSum";\n'+text;const index=text.indexOf('  const iter = array.entries();');text=text.slice(0,index)+'  return stableSum(array.map((item, index) => callbackfn(item, index, array)));\n};\n';await writeFile(sumBy,text);
 const meanBy=p('meanBy.ts');text=await readFile(meanBy,'utf8');text='import { sumBy } from "./sumBy";\n'+text;const at=text.indexOf('  let sum = 0;');text=text.slice(0,at)+'  return sumBy(array, fn) / array.length;\n};\n';await writeFile(meanBy,text);
 }else if(id==='remeda-null-keys'){
 for(const name of ['groupBy','countBy']){const f=p(name+'.ts');await replace(f,'| undefined','| null | undefined');await replace(f,name==='groupBy'?'key !== undefined':'category !== undefined',name==='groupBy'?'key != null':'category != null');}
 const f=p('indexBy.ts');await replace(f,') => K',') => K | null | undefined');await replace(f,'const out: Partial<Record<K, T>> = {};','const out: Partial<Record<K, T>> = Object.create(null);');await replace(f,'    out[key] = item;','    if (key != null) out[key] = item;');await replace(f,'  return out as BoundedPartial<Record<K, T>>;','  Object.setPrototypeOf(out, Object.prototype);\n  return out as BoundedPartial<Record<K, T>>;');
 }else{
 for(const name of ['zip','zipWith']){const f=p(name+'.ts');await replace(f,name==='zip'?'  (value, index) => ({':'  (value, index, data) => ({',name==='zip'?'  (value, index) => second.length === 0 ? ({ hasNext: false, done: true }) : ({':'  (value, index, data) => second.length === 0 ? ({ hasNext: false, done: true }) : ({');}
 }
}
export function check(root,name){const result=spawnSync('npm',['run','test:study:'+name],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,TZ:'UTC'}});return {name,exitCode:result.status,signal:result.signal,error:result.error?.code??null,stdout:result.stdout,stderr:result.stderr};}
if(process.argv[1]===import.meta.filename){const rows=[];await mkdir(join(work,'controls'),{recursive:true});for(const task of tasks){const root=join(work,'controls',task.id);await prepare(root,task.id);const before=['regression','feature','types'].map(name=>check(root,name));await positive(root,task.id);const after=['regression','feature','types'].map(name=>check(root,name));let diff=execFileSync('git',['diff','HEAD'],{cwd:root,encoding:'utf8'}); for(const file of execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)){const extra=spawnSync('git',['diff','--no-index','--binary','--','/dev/null',file],{cwd:root,encoding:'utf8'});assert.equal(extra.status,1);diff+=extra.stdout;} await writeFile(join(study,'positive-'+task.id+'.patch'),diff);rows.push({task:task.id,before,after});await save(join(study,'oracle-controls.json'),rows);console.log(JSON.stringify({task:task.id,before:before.map(x=>x.exitCode),after:after.map(x=>x.exitCode)}));}assert.ok(rows.every(r=>r.before[0].exitCode===0&&r.before[1].exitCode===1&&r.after.every(x=>x.exitCode===0)));}
