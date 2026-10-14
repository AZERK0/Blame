import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
// Zero-model mechanism control; use a frozen pre-fix runtime or the new build.
const expected=process.argv[3];
assert(['before','after'].includes(expected),'Pass runtime/dist and before|after');
const dist=resolve(process.argv[2]);
const {LightWorkspace}=await import(pathToFileURL(join(dist,'harness/light-workspace.js')));
const {LightFinishService}=await import(pathToFileURL(join(dist,'harness/light-finish-service.js')));
const {SessionJournal}=await import(pathToFileURL(join(dist,'harness/session-journal.js')));
const rows=[];
for(const [name,script,required] of [
 ['missing-lint',"sh -c 'blame_absent_lint_7284 --version'",false],
 ['missing-required-lint',"sh -c 'blame_absent_lint_7284 --version'",true],
 ['ordinary-code-failure','node check.cjs',false],
 ['shell-looking-exit-one','node shell-looking.cjs',false],
]) {
 const root=await mkdtemp(join(tmpdir(),'blame-shell-control-'));
 try {
  await writeFile(join(root,'package.json'),JSON.stringify({scripts:{lint_src:script}}));
  await writeFile(join(root,'value.ts'),'export const value = 1;\n');
  await writeFile(join(root,'check.cjs'),"console.error('Error: symbol not found');process.exit(1);\n");
  await writeFile(join(root,'shell-looking.cjs'),"console.error('sh: 1: example: not found');process.exit(1);\n");
  const workspace=new LightWorkspace(root,{sessionId:name});
  await workspace.readCode({target:'value.ts',view:'raw'},{});
  const edit=await workspace.editCode({operations:[{kind:'patch',path:'value.ts',patch:'*** Begin Patch\n*** Update File: value.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch'}]});
  if(edit.status!=='ok')throw Error(JSON.stringify(edit));
  const run=await workspace.runTask({kind:'project',task:'lint_src'},{});
  const notifications=[];const activities=[];
  const service=new LightFinishService({workspaceRoot:root,conversationId:name,taskContract:{required_checks:required?[{id:'lint',task:'lint_src'}]:[]},onComplete:n=>{notifications.push(n)},onValidationActivity:a=>{activities.push(a)}});
  let finishError=null;
  try{await service.finish('Source changed; lint did not pass. Missing tooling remains a limitation.',{});await service.finish('Still disclosed.',{});}catch(e){finishError=e.message;}
  const state=await new SessionJournal(root,name).completionSnapshot();
  rows.push({name,run,finishError,notifications,automaticRuns:activities.filter(a=>a.phase==='started').length,validations:state.validations});
 }finally{await rm(root,{recursive:true,force:true});}
}
for(const row of rows){
 const repaired=expected==='after'&&row.name.startsWith('missing-');
 assert.equal(row.run.category,repaired?'environment':'code');
 assert.equal(row.finishError===null,repaired);
 assert.equal(row.automaticRuns,0);
 if(repaired){
  assert.equal(row.notifications.length,2);
  assert(row.notifications.every(n=>!n.verified&&n.completion.verification==='unverified'));
  assert.deepEqual(row.notifications[0].completion.missing_obligations,row.name==='missing-required-lint'?['check:lint']:[]);
  assert(row.validations.some(v=>v.category==='environment'&&v.terminal==='failed'));
  assert(!row.validations.some(v=>v.status==='passed'));
 }else assert.match(row.finishError,/Current validation is still failing/);
}
process.stdout.write(JSON.stringify({paidRequests:0,expected,rows},null,2)+'\n');
