// Same production file set; only validated prototype production bytes can differ.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,cp,readdir,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),parent=join(repo,'.blame/research/guidance-f28/frozen/f28/bundle');
const prototype=join(repo,'.blame/research/guidance-f28/sources/phrase-prototype/packages/agent-runtime/dist');
const variants=[],different=[];
for(const arm of ['baseline','candidate']){
 const root=join(work,'frozen/f29',arm);await mkdir(root,{recursive:true});
 for(const name of ['agent-runtime','benchmark-runner']){
  const from=join(parent,name,'dist'),to=join(root,name,'dist');await cp(from,to,{recursive:true,errorOnExist:true,force:false});
  if(arm==='candidate'&&name==='agent-runtime')for(const entry of await readdir(from,{recursive:true,withFileTypes:true}))if(entry.isFile()){
   const path=join(entry.parentPath??entry.path,entry.name).slice(from.length+1),old=await readFile(join(from,path)),next=await readFile(join(prototype,path));
   if(sha(old)!==sha(next)){different.push(path);await writeFile(join(to,path),next);}
  }
  await writeFile(join(root,name,'package.json'),'{"type":"module","exports":"./dist/index.js"}\n',{flag:'wx'});
  if(name==='agent-runtime')await symlink(join(repo,'packages/agent-runtime/node_modules'),join(root,name,'node_modules'),'dir');
  else{await mkdir(join(root,name,'node_modules/@blame'),{recursive:true});await symlink(join(root,'agent-runtime'),join(root,name,'node_modules/@blame/agent-runtime'),'dir');}
 }
 const version={arm,sourceCommit:'5f31042529dd5c633909267df27398418a49ebbd',patchSha256:sha(arm==='candidate'?await readFile(join(study,'candidate.patch')):''),
  changedPaths:arm==='candidate'?['packages/agent-runtime/src/harness/light-workspace.ts','packages/agent-runtime/src/harness/light-navigation.ts']:[]};
 await writeFile(join(root,'version.json'),JSON.stringify(version,null,2)+'\n',{flag:'wx'});variants.push(version);
}
assert.deepEqual(different.sort(),['harness/light-navigation.d.ts.map','harness/light-navigation.js','harness/light-workspace.d.ts.map','harness/light-workspace.js']);
await writeFile(join(study,'variant-sources.json'),JSON.stringify(variants,null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'isolation-controls.json'),JSON.stringify({paidRequests:0,productionFileSetIdentical:true,frozenModuleHashes:Object.fromEntries(await Promise.all(['baseline','candidate'].map(async arm=>[arm,Object.fromEntries(await Promise.all(['light-workspace.js','light-navigation.js'].map(async f=>[f,sha(await readFile(join(work,'frozen/f29',arm,'agent-runtime/dist/harness',f)))])))]))),differentProductionFiles:different,differentExecutableFiles:different.filter(p=>p.endsWith(".js")),unchangedSchemasPromptsEditValidationModules:true},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,differentProductionFiles:different}));
