// Description-only research ablation. No production source is overwritten.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,readdir,symlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {repo,work,study} from './paths.mjs';
const require=createRequire(join(repo,'packages/agent-runtime/package.json')),ts=require('typescript');
const sha=b=>createHash('sha256').update(b).digest('hex');
const descriptions={
 search_code:'Find paths, text, symbols or references. Compiler references require an sN or path#qualifiedName target; bare names fall back to lexical search. Read results before editing. Query terms use whitespace; punctuation is literal. Scope paths/globs accept arrays; spaces inside one scope are literal. Returns up to eight results; generated files and node_modules excluded.',
 read_code:'Read files/images, directories, sN, path#qualifiedName, @changes, @checks or @capabilities. Omit view for auto routing; ranges select lines. Signature view omits the body and grants no body-edit coverage. Read the complete symbol before behavioral edits or rename. Follow nextRead after truncation; editTargets/containedBy describe edit boundaries. @checks observes without running; null counts are unknown.',
 edit_code:'Apply atomic symbol operations or Cline patches. Example: {"operations":[{"kind":"symbol","target":"s1","action":"replace_body","content":"return 2;"}]}. replace_body replaces only the entire observed body; use whole-symbol replace to change parameters. Unbraced bodies inherit indentation; braces preserve explicit layout. Rename: sole operation, new identifier in content, complete declaration read first. Compiler guards are not test evidence. A symbol-target patch permits one matching Update File header; file patches use explicit paths and exact preimages. Avoid parent/containedBy-child overlap.',
 finish_task:'Finish with a concise factual summary. Use run_task reporting or @checks: null/unreported counts are unknown; pending differs from skipped. Distinguish execution, passing tests, admitted verification and user criteria. Runtime reuses current checks or refreshes requested checks; unchecked work stays unverified. Omit receipts/internal state.',
};
const runExpression=JSON.stringify('Run project tasks, commands or setup. Poll a running rN with its cursor instead of relaunching. Source changes require a subsequent check; finish_task reuses fresh checks. Use dependency operations for Node packages. ')+
 ' + (environment?.managedPreview === false ? '+JSON.stringify('Detach requested services with redirected input/output. ')+ ' : '+JSON.stringify('Use managed preview for services. ')+') + '+
 JSON.stringify('Explicit-file Prettier edits are atomic. Output is bounded; null counts are unknown and pending differs from skipped.');
const changed=[],sources=[];
for(const name of ['light-tools','light-completion']){
 const relative='packages/agent-runtime/src/harness/'+name+'.ts',original=await readFile(join(repo,relative),'utf8');
 const source=ts.createSourceFile(relative,original,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS),replacements=[];
 function visit(node){
  if(ts.isObjectLiteralExpression(node)){
   const nameProperty=node.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='name');
   const description=node.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(source)==='description');
   if(nameProperty&&description){
    const text=nameProperty.initializer.getText(source),key=text==='lightCompletionToolName'?'finish_task':text.slice(1,-1);
    if(key in descriptions||key==='run_task')replacements.push({key,start:description.initializer.getStart(source),end:description.initializer.end,value:key==='run_task'?runExpression:JSON.stringify(descriptions[key])});
   }
  }
  ts.forEachChild(node,visit);
 }visit(source);
 assert.equal(replacements.length,name==='light-tools'?4:1);
 let candidate=original;for(const r of replacements.sort((a,b)=>b.start-a.start))candidate=candidate.slice(0,r.start)+r.value+candidate.slice(r.end);
 const emit=text=>ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const baselineJs=await readFile(join(repo,'packages/agent-runtime/dist/harness',name+'.js'),'utf8');assert.equal(emit(original),baselineJs,'Baseline must match current TS compiler emit');
 const temp=join(work,'source-pairs',relative);await mkdir(join(temp,'..'),{recursive:true});await writeFile(temp,original);
 const after=temp+'.candidate';await writeFile(after,candidate);
 const diff=spawnSync('git',['diff','--no-index','--',temp,after],{encoding:'utf8'});assert.equal(diff.status,1);
 const patch='diff --git a/'+relative+' b/'+relative+'\n--- a/'+relative+'\n+++ b/'+relative+'\n'+diff.stdout.slice(diff.stdout.indexOf('@@'));
 sources.push({relative,originalSha256:sha(original),candidateSha256:sha(candidate),descriptionNames:replacements.map(r=>r.key)});changed.push({name,js:emit(candidate),patch});
}
await writeFile(join(study,'candidate.patch'),changed.map(r=>r.patch).join(''),{flag:'wx'});
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const variants=[];
for(const arm of ['baseline','candidate']){
 const root=join(work,'frozen/f30',arm);await mkdir(root,{recursive:true});
 for(const name of ['agent-runtime','benchmark-runner']){
  const from=join(repo,'packages',name,'dist'),to=join(root,name,'dist');await cp(from,to,{recursive:true,errorOnExist:true,force:false});
  if(arm==='candidate'&&name==='agent-runtime')for(const change of changed)await writeFile(join(to,'harness',change.name+'.js'),change.js);
  await writeFile(join(root,name,'package.json'),'{"type":"module","exports":"./dist/index.js"}\n',{flag:'wx'});
  if(name==='agent-runtime')await symlink(join(repo,'packages/agent-runtime/node_modules'),join(root,name,'node_modules'),'dir');
  else{await mkdir(join(root,name,'node_modules/@blame'),{recursive:true});await symlink(join(root,'agent-runtime'),join(root,name,'node_modules/@blame/agent-runtime'),'dir');}
 }
 const version={arm,sourceCommit:commit,patchSha256:sha(arm==='candidate'?await readFile(join(study,'candidate.patch')):''),changedPaths:arm==='candidate'?sources.map(s=>s.relative):[]};
 await writeFile(join(root,'version.json'),JSON.stringify(version,null,2)+'\n',{flag:'wx'});variants.push(version);
}
const base=join(work,'frozen/f30/baseline/agent-runtime/dist'),candidate=join(work,'frozen/f30/candidate/agent-runtime/dist'),differences=[];
for(const e of await readdir(base,{recursive:true,withFileTypes:true}))if(e.isFile()){
 const relative=join(e.parentPath??e.path,e.name).slice(base.length+1);if(sha(await readFile(join(base,relative)))!==sha(await readFile(join(candidate,relative))))differences.push(relative);
}
assert.deepEqual(differences.sort(),['harness/light-completion.js','harness/light-tools.js']);
await writeFile(join(study,'variant-sources.json'),JSON.stringify(variants,null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'isolation-controls.json'),JSON.stringify({paidRequests:0,method:'Only five description initializers differ in TS. Baseline emit byte-identical to current compiler; full frozen dist comparison has exactly two changed executable modules. Schemas,executors,guards,receipts and system prompts unchanged.',sources,differentExecutableFiles:differences},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,differentExecutableFiles:differences}));
