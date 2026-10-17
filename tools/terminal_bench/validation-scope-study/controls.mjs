import assert from 'node:assert/strict';import {spawnSync,execFileSync} from 'node:child_process';import {readFile,writeFile,mkdir} from 'node:fs/promises';import{join}from'node:path';
import{work,study,prepare,save,sha,sourceRoot}from'./setup.mjs';import{tasks}from'./tasks.mjs';
async function replace(path,from,to){const s=await readFile(path,'utf8');assert.ok(s.includes(from),path+' missing anchor');await writeFile(path,s.replaceAll(from,to));}
export async function positive(root,id){
 const src=join(root,sourceRoot(id.split('-')[0]));
 if(id==='valibot-parser-overrides')for(const name of ['parser','parserAsync','safeParser','safeParserAsync']){
  const file=join(src,'methods',name.startsWith('safe')?'safeParser':'parser',name+'.ts');
  await replace(file,'(input: unknown):','(input: unknown, override?: Config<InferIssue<TSchema>>):');
  const called=name.startsWith('safe')?(name.endsWith('Async')?'safeParseAsync':'safeParse'):(name.endsWith('Async')?'parseAsync':'parse');
  await replace(file,`(input: unknown) => ${called}(schema, input, config)`,`(input: unknown, override?: Config<BaseIssue<unknown>>) => ${called}(schema, input, override === undefined ? config : { ...config, ...override })`);
 }else if(id==='valibot-summary-format'){
  const file=join(src,'methods/summarize/summarize.ts');
  await replace(file,'export function summarize(','export interface SummaryOptions { bullet?: string | undefined; indent?: string | undefined; includePath?: boolean | undefined; }\n\nexport function summarize(');
  await replace(file,'  issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]]\n','  issues: [BaseIssue<unknown>, ...BaseIssue<unknown>[]],\n  options?: SummaryOptions\n');
  await replace(file,'`× ${issue.message}`',"`${options?.bullet ?? '×'} ${issue.message}`");
  await replace(file,'if (dotPath) {','if (dotPath && options?.includePath !== false) {');
  await replace(file,'`\\n  → at ${dotPath}`',"`\\n${options?.indent ?? '  '}→ at ${dotPath}`");
 }else{
  const file=join(src,'take.ts');
  await replace(file,'  if (n <= 0) {','  n = Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));\n  if (n <= 0) {');
  const pipe=join(src,'pipe.ts');
  await replace(pipe,'import { SKIP_ITEM }','import { SKIP_ITEM, lazyEmptyEvaluator }');
  await replace(pipe,'  readonly isSingle: boolean;','  readonly isSingle: boolean;\n  readonly isEmpty: boolean;');
  await replace(pipe,'    isSingle: lazy.single ?? false,','    isSingle: lazy.single ?? false,\n    isEmpty: fn === lazyEmptyEvaluator,');
  await replace(pipe,'for (const value of output) {','for (const value of (lazySequence.some(fn => fn.isEmpty) ? [] : output)) {');
 }
 const relativeImport=id.startsWith('valibot')?'./index.ts':'./index';
 const body=id==='valibot-parser-overrides'?"expect(v.safeParser(v.string())(1,{message:'custom'}).issues?.[0].message).toBe('custom');":id==='valibot-summary-format'?"const result=v.safeParse(v.string('bad'),123);if(!result.success)expect(v.summarize(result.issues,{bullet:'!'})).toBe('! bad');":"expect(v.pipe([1,2],v.map(x=>x),v.take(0.5))).toEqual([]);";
 await writeFile(join(src,'scope-regression.test.ts'),`import {test,expect} from 'vitest';\nimport * as v from '${relativeImport}';\ntest('requested regression',()=>{${body}});\n`);
}
export function check(root,name){const args=name==='delivered-types'?['run','typecheck:delivered']:['run','test:study:'+name];const r=spawnSync('npm',args,{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,TZ:'UTC',PATH:join(root,'node_modules/.bin')+':'+process.env.PATH,npm_config_offline:'true',npm_config_update_notifier:'false'}});return{name,exitCode:r.status,signal:r.signal,error:r.error?.code??null,stdout:r.stdout,stderr:r.stderr};}
if(process.argv[1]===import.meta.filename){
 await mkdir(join(work,'controls'),{recursive:true});const rows=[];
 for(const task of tasks){const root=join(work,'controls',task.id);await prepare(root,task.id);const before=['regression','feature','types','upstream','delivered','delivered-types'].map(n=>check(root,n));await positive(root,task.id);const after=before.map(c=>check(root,c.name));
  let diff=execFileSync('git',['diff','--binary','HEAD'],{cwd:root,encoding:'utf8'});for(const path of execFileSync('git',['ls-files','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean)){const p=spawnSync('git',['diff','--no-index','--binary','--','/dev/null',path],{cwd:root,encoding:'utf8'});assert.equal(p.status,1);diff+=p.stdout;}
  await writeFile(join(study,'positive-'+task.id+'.patch'),diff);rows.push({task:task.id,before,after});await save(join(study,'oracle-controls.json'),{complete:false,rows});console.log(task.id,JSON.stringify({before:before.map(c=>c.exitCode),after:after.map(c=>c.exitCode)}));
 }
 assert.ok(rows.every(r=>r.before[0].exitCode===0&&r.before[1].exitCode!==0&&r.before[3].exitCode===0&&r.after.every(c=>c.exitCode===0)));
 await save(join(study,'oracle-controls.json'),{complete:true,setupSha256:sha(await readFile(join(import.meta.dirname,'setup.mjs'))),rows});
}
