// Public, no-model reproduction of the focused upstream/added-test audit.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {study,json,save,sha} from './setup.mjs';
const option=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
const output=option('output');assert.ok(output,'Explicit --output is required');
await access(resolve(output)).then(()=>{throw Error('Refusing to overwrite audit replay');},e=>{if(e.code!=='ENOENT')throw e;});
const witness=await json(join(study,'upstream-tests-witness.json')),results=await json(join(study,'results.json'));
const lockBytes=await readFile(join(study,'upstream-audit-package-lock.json'));
assert.equal(sha(lockBytes),witness.dependencyLockSha256);
const lock=JSON.parse(lockBytes),deps=resolve(option('dependencies')??'/tmp/blame-f43-public-audit-dependencies');
await mkdir(deps,{recursive:true});
const existing=await readFile(join(deps,'package-lock.json')).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
if(existing)assert.equal(sha(existing),sha(lockBytes));
else{await writeFile(join(deps,'package-lock.json'),lockBytes,{flag:'wx'});await save(join(deps,'package.json'),{name:lock.name,private:true,type:'module',dependencies:lock.packages[''].dependencies});}
const installed=await access(join(deps,'node_modules')).then(()=>true,()=>false);
if(!installed){assert.ok(process.argv.includes('--install'),'Re-run with --install for the pinned audit dependencies');const p=spawnSync('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:deps,stdio:'inherit'});assert.equal(p.status,0);}
for(const[name,version]of Object.entries(lock.packages[''].dependencies))assert.equal((await json(join(deps,'node_modules',name,'package.json'))).version,version);
const upstream=join(study,'inputs/valibot.tar.gz'),prefix='valibot-63dfa76dbf4f78144398815015947a7cc4d12c4b';
assert.equal(sha(await readFile(upstream)),(await json(join(study,'input-archives.json'))).artifacts['valibot.tar.gz']);
const only=option('only')?.split(','),records=[],root=await mkdtemp(join(tmpdir(),'blame-f43-audit-replay-'));
if(only)for(const name of only)assert.ok(results.rows.some(r=>r.name===name),'Unknown endpoint: '+name);
try{
 for(const expected of witness.records.filter(r=>r.name.startsWith('original-')||!only||only.includes(r.name))){
  const folder=join(root,expected.name);await mkdir(folder);
  execFileSync('tar',['-xzf',upstream,'--strip-components=1','-C',folder,prefix+'/library']);
  const row=results.rows.find(r=>r.name===expected.name);
  if(row){
   const zipped=await readFile(join(study,'traces',row.name+'.json.gz'));assert.equal(sha(zipped),row.traceSha256);
   const files=JSON.parse(gunzipSync(zipped)).files;
   const bytes=name=>{const b=Buffer.from(files[name].base64,'base64');assert.equal(sha(b),files[name].sha256);return b;};
   const patch=join(root,expected.name+'.patch');await writeFile(patch,bytes('workspace.diff'));
   execFileSync('git',['apply','--binary','--include=library/**',patch],{cwd:folder});
   for(const[path,hash]of Object.entries(JSON.parse(bytes('score.json')).sourceHashes))if(path.startsWith('library/'))assert.equal(sha(await readFile(join(folder,path))),hash);
  }
  await symlink(join(deps,'node_modules'),join(folder,'node_modules'));await save(join(folder,'package.json'),{type:'module'});
  if(expected.extraTypes.length)await writeFile(join(folder,'explicit-generics.ts'),"import {fallback,fallbackAsync,string} from './library/src/index.ts';\nconst schema=string();\nfallback<typeof schema,'fallback'>(schema,'fallback');\nfallbackAsync<typeof schema,'fallback'>(schema,'fallback');\n");
  async function checks(paths){
   await writeFile(join(folder,'audit.config.mjs'),'export default '+JSON.stringify({test:{include:paths.filter(p=>p.endsWith('.test.ts')),maxWorkers:1,fileParallelism:false,cache:false}})+';\n');
   await save(join(folder,'audit.tsconfig.json'),{compilerOptions:{strict:true,noEmit:true,target:'ES2022',lib:['ESNext','DOM'],module:'ESNext',moduleResolution:'Bundler',allowImportingTsExtensions:true,skipLibCheck:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:false,types:['node']},files:[...paths,...expected.extraTypes]});
   const run=(tool,args)=>{const p=spawnSync(process.execPath,[join(deps,'node_modules',tool),...args],{cwd:folder,encoding:'utf8',timeout:60000,maxBuffer:4*1024*1024,env:{...process.env,TZ:'UTC',NO_COLOR:'1'}});return{exitCode:p.status,signal:p.signal,error:p.error?.code??null,stdout:p.stdout,stderr:p.stderr};};
   return{runtime:run('vitest/vitest.mjs',['run','--config','audit.config.mjs']),types:run('typescript/bin/tsc',['-p','audit.tsconfig.json'])};
  }
  const exact=await checks(expected.testPaths);
  for(const path of expected.testPaths){const p=spawnSync('tar',['-xOf',upstream,prefix+'/'+path],{maxBuffer:4*1024*1024});if(p.status===0)await writeFile(join(folder,path),p.stdout);else await rm(join(folder,path),{force:true});}
  const preservation=await checks(expected.selectedTests);
  const matches=['exact','preservation'].every(scope=>['runtime','types'].every(kind=>{const actual={exact,preservation}[scope][kind],before=expected[scope][kind];return actual.exitCode===before.exitCode&&actual.signal===before.signal;}));
  records.push({name:expected.name,matches,exact,preservation});console.log(expected.name,matches?'MATCH':'MISMATCH');
  await rm(folder,{recursive:true});
 }
 await writeFile(resolve(output),JSON.stringify({modelRequests:0,complete:!only,selected:only??null,dependencyLockSha256:sha(lockBytes),method:'Public upstream archive plus original published patches; exact production source hashes, original focused runtime/type checks and delivered tests. No endpoint repair, model call or new success. Baseline controls always run. Compare to archived audit exit codes/signals.',records},null,2)+'\n',{flag:'wx'});
 if(records.some(r=>!r.matches))process.exitCode=1;
}finally{await rm(root,{recursive:true,force:true});}
