// Freeze two runtimes. Only one production executable module differs.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,readdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {repo,work,study} from './paths.mjs';
const require=createRequire(join(repo,'packages/agent-runtime/package.json')),ts=require('typescript');
const sha=b=>createHash('sha256').update(b).digest('hex');
const relative='packages/agent-runtime/src/harness/light-edit.ts',commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const before=execFileSync('git',['show',commit+':'+relative],{cwd:repo,encoding:'utf8'}),after=await readFile(join(repo,relative),'utf8');
assert.notEqual(before,after);
const emit=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
assert.equal(emit(after),await readFile(join(repo,'packages/agent-runtime/dist/harness/light-edit.js'),'utf8'));
const patch=execFileSync('git',['diff','--',relative],{cwd:repo});
await writeFile(join(study,'candidate.patch'),patch);
const variants=[];
for(const arm of ['baseline','candidate']){
 const root=join(work,'frozen/f31',arm);await mkdir(root,{recursive:true});
 for(const name of ['agent-runtime','benchmark-runner']){
  const to=join(root,name,'dist');await cp(join(repo,'packages',name,'dist'),to,{recursive:true,errorOnExist:true,force:false});
  if(name==='agent-runtime')await writeFile(join(to,'harness/light-edit.js'),emit(arm==='baseline'?before:after));
  await writeFile(join(root,name,'package.json'),'{"type":"module","exports":"./dist/index.js"}\n',{flag:'wx'});
  if(name==='agent-runtime')await symlink(join(repo,'packages/agent-runtime/node_modules'),join(root,name,'node_modules'),'dir');
  else{await mkdir(join(root,name,'node_modules/@blame'),{recursive:true});await symlink(join(root,'agent-runtime'),join(root,name,'node_modules/@blame/agent-runtime'),'dir');}
 }
 const version={arm,sourceCommit:commit,patchSha256:sha(arm==='candidate'?patch:''),changedPaths:arm==='candidate'?[relative]:[]};
 await writeFile(join(root,'version.json'),JSON.stringify(version,null,2)+'\n',{flag:'wx'});variants.push(version);
}
const base=join(work,'frozen/f31/baseline/agent-runtime/dist'),candidate=join(work,'frozen/f31/candidate/agent-runtime/dist'),differences=[];
for(const e of await readdir(base,{recursive:true,withFileTypes:true}))if(e.isFile()){
 const relative=join(e.parentPath??e.path,e.name).slice(base.length+1);
 if(sha(await readFile(join(base,relative)))!==sha(await readFile(join(candidate,relative))))differences.push(relative);
}
assert.deepEqual(differences,['harness/light-edit.js']);
await writeFile(join(study,'variant-sources.json'),JSON.stringify(variants,null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'isolation-controls.json'),JSON.stringify({paidRequests:0,differentExecutableFiles:differences,source:{relative,baselineSha256:sha(before),candidateSha256:sha(after)},method:'Only whole-symbol first-line indentation handling changes. Identical tool descriptions,schemas,prompts,other executors,body edits,rename,guards and receipts. JS/TS/JSX/TSX only; exact matching existing whitespace prefix stripped once from first line,never later lines. Inline and other-language behavior unchanged.'},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,differentExecutableFiles:differences}));
