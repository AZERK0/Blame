// Post-hoc preservation audit, not an extra model attempt or an official score.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,writeFile,readFile,rm,symlink,cp,access} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {work as inputWork,study as defaultStudy,json,save,sha,sourceRoot} from './setup.mjs';
const positional=process.argv.slice(2).filter(a=>!a.startsWith('--'));
const work=positional[0]?resolve(positional[0]):inputWork,study=positional[1]?resolve(positional[1]):defaultStudy;
const protocol=await json(join(study,'protocol.json')),tasks=protocol.tasks;
const startedAtUTC=new Date().toISOString();
const dependencyRoot='/tmp/blame-f42-upstream-test-audit';
const root=join(dependencyRoot,'workspaces');await mkdir(root,{recursive:true});
const selected={
 'valibot-message-prefix':['storages/globalConfig/globalConfig','utils/_addIssue/_addIssue'],
 'valibot-hide-input':['storages/globalConfig/globalConfig','utils/_addIssue/_addIssue'],
 'valibot-fallback-when':['methods/fallback/fallback','methods/fallback/fallbackAsync'],
 'remeda-stable-sum':['sum','sumBy','mean','meanBy'],
 'remeda-null-keys':['groupBy','countBy','indexBy'],
 'remeda-empty-zip':['zip','zipWith'],
};
const prefixes={valibot:'valibot-63dfa76dbf4f78144398815015947a7cc4d12c4b',remeda:'remeda-729ead3f458a24167154e5ba6e9305022baabfcf'};
const analysis=await json(join(work,'campaign/analysis.json'));
const filter=process.argv.find(a=>a.startsWith('--only='))?.slice(7).split(',');
const slots=[...tasks.map(t=>({name:'original-'+t.id,task:t.id,original:true})),...analysis.rows].filter(r=>!filter||r.original||filter.includes(r.name));
const records=[];
for(const row of slots){
 const project=row.task.split('-')[0],src=sourceRoot(project),folder=join(root,row.name);
 await mkdir(folder);const original=join(inputWork,'upstream',project+'.tar.gz');
 const archive=row.original?original:join(work,'campaign',row.name,'workspace.tar.gz');
 execFileSync('tar',['-xzf',archive,'--strip-components=1','-C',folder,(row.original?prefixes[project]:'workspace')+'/'+src]);
 await symlink(join(dependencyRoot,'node_modules'),join(folder,'node_modules'));
 await writeFile(join(folder,'package.json'),'{"type":"module"}\n');
 const grade=row.original?null:await json(join(work,'campaign',row.name,'score.json'));
 if(grade)for(const[path,hash]of Object.entries(grade.sourceHashes))if(path.startsWith(src+'/'))assert.equal(await readFile(join(folder,path)).then(sha,()=>null),hash);
 const selectedTests=[];
 const originalPaths=new Set(execFileSync('tar',['-tzf',original],{encoding:'utf8'}).split('\n').map(p=>p.split('/').slice(1).join('/')));
 for(const base of selected[row.task])for(const suffix of ['.test.ts','.test-d.ts']){
  const path=src+'/'+base+suffix;
  if(originalPaths.has(path))selectedTests.push(path);
 }
 // Include changed/new tests in these source modules; keep their exact bytes.
 const changedTests=(grade?.changedPaths??[]).filter(p=>p.startsWith(src+'/')&&/\.test(?:-d)?\.ts$/.test(p));
 const testPaths=[...new Set([...selectedTests,...changedTests])];
 const extraTypes=row.task==='valibot-fallback-when'?['explicit-generics.ts']:[];
 if(extraTypes.length)await writeFile(join(folder,extraTypes[0]),"import {fallback,fallbackAsync,string} from './library/src/index.ts';\nconst schema=string();\nfallback<typeof schema,'fallback'>(schema,'fallback');\nfallbackAsync<typeof schema,'fallback'>(schema,'fallback');\n");
 const config={test:{include:testPaths.filter(p=>p.endsWith('.test.ts')),maxWorkers:1,fileParallelism:false,cache:false}};
 await writeFile(join(folder,'audit.config.mjs'),'export default '+JSON.stringify(config)+';\n');
 await save(join(folder,'audit.tsconfig.json'),{compilerOptions:{strict:true,noEmit:true,target:'ES2022',lib:['ESNext','DOM'],module:'ESNext',moduleResolution:'Bundler',allowImportingTsExtensions:true,skipLibCheck:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:project==='remeda',types:['node']},files:[...testPaths,...extraTypes]});
 const run=(tool,args)=>{const p=spawnSync(process.execPath,[join(dependencyRoot,'node_modules',tool),...args],{cwd:folder,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,TZ:'UTC',NO_COLOR:'1'}});return{exitCode:p.status,signal:p.signal,error:p.error?.code??null,stdout:p.stdout,stderr:p.stderr};};
 const exact={runtime:run('vitest/vitest.mjs',['run','--config','audit.config.mjs']),types:run('typescript/bin/tsc',['-p','audit.tsconfig.json'])};
 // Replay the original related assertions against the unchanged agent implementation.
 for(const path of testPaths){
  const p=spawnSync('tar',['-xOf',original,prefixes[project]+'/'+path],{maxBuffer:4*1024*1024});
  if(p.status===0)await writeFile(join(folder,path),p.stdout);else await rm(join(folder,path),{force:true});
 }
 await writeFile(join(folder,'audit.config.mjs'),'export default '+JSON.stringify({test:{...config.test,include:selectedTests.filter(p=>p.endsWith('.test.ts'))}})+';\n');
 const tsconfig=await json(join(folder,'audit.tsconfig.json'));tsconfig.files=[...selectedTests,...extraTypes];await save(join(folder,'audit.tsconfig.json'),tsconfig);
 const preservation=changedTests.length===0?exact:{runtime:run('vitest/vitest.mjs',['run','--config','audit.config.mjs']),types:run('typescript/bin/tsc',['-p','audit.tsconfig.json'])};
 const record={name:row.name,task:row.task,hashes:row.hashes??null,selectedTests,testPaths,extraTypes,exact,preservation};records.push(record);
 console.log(row.name,JSON.stringify({exact:[exact.runtime.exitCode,exact.types.exitCode],preservation:[preservation.runtime.exitCode,preservation.types.exitCode]}));
 await rm(folder,{recursive:true});
}
const lock=await readFile(join(dependencyRoot,'package-lock.json'));
await cp(join(dependencyRoot,'package-lock.json'),join(study,'upstream-audit-package-lock.json'));
await save(join(study,filter?'upstream-tests-smoke.json':'upstream-tests-witness.json'),{startedAtUTC,endedAtUTC:new Date().toISOString(),dependencyLockSha256:sha(lock),complete:!filter&&analysis.rows.length===protocol.order.length,
 method:'Post-hoc focused upstream regression and added-test audit, motivated by unexecuted model-added tests and changed absent-option config shapes. An explicit two-type-argument fallback compatibility fixture was added after reviewing trial 25. Exact archived production source is never repaired. Run the same related upstream assertions/types for every arm/repeat, and separately execute exact model-added/modified tests. Baseline controls distinguish pre-existing failures and harness configuration problems. This is not the full upstream suite or an official selected check. Dependencies are isolated outside the measured repository, installed with a separate npm cache and pinned lock.',records});
