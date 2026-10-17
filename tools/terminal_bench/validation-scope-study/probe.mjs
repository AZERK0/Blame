// Known diagnostic only; no model calls or solution repairs.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,symlink,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const repo=resolve(import.meta.dirname,'../../..');
const runtime=resolve(process.argv[2]??join(repo,'packages/agent-runtime/dist/harness'));
const {LightWorkspace}=await import(pathToFileURL(join(runtime,'light-workspace.js')));
const {LightFinishService}=await import(pathToFileURL(join(runtime,'light-finish-service.js')));
const records=[];
for(const task of ['test:study:types','typecheck']){
 const root=await mkdtemp(join(tmpdir(),'blame-f44-scope-'));
 try{
  await mkdir(join(root,'node_modules'));await symlink(join(repo,'packages/agent-runtime/node_modules/typescript'),join(root,'node_modules/typescript'));
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{[task]:'node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json'}}));
  await writeFile(join(root,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,types:[]},files:['included.ts']}));
  await writeFile(join(root,'included.ts'),'export const value: number = 1;\n');
  const workspace=new LightWorkspace(root,{sessionId:'scope-probe'});
  const edit=await workspace.editCode({operations:[{kind:'patch',path:'excluded.test.ts',patch:"export const broken: number = 'not compiled';\n"}]});assert.equal(edit.status,'ok');
  const run=await workspace.runTask({kind:'project',task},{});assert.equal(run.status,'ok');assert.equal(run.data.exitCode,0);
  const notifications=[];const finish=new LightFinishService({workspaceRoot:root,conversationId:'scope-probe',onComplete:n=>notifications.push(n),taskContract:{session_id:'scope-probe',required_checks:[{id:'types',task}]}});
  await finish.finish('The command passed; the changed test is excluded.',{});
  records.push({task,run,completion:notifications.at(-1),expected:{compilerInvocationPassed:true,excludedTestChecked:false,sourceVerification:false}});
 }finally{await rm(root,{recursive:true,force:true});}
}
console.log(JSON.stringify({modelRequests:0,runtime,records},null,2));
