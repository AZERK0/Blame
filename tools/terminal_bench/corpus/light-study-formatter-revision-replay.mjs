// Controlled local post-format external change; never model feedback.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const rows=[];
for(const requested of process.argv.slice(2)) for (const variant of ['markdown','typescript']) {
 const runtime=resolve(requested), load=name=>import(pathToFileURL(join(runtime,'dist/harness',name+'.js')));
 const {LightWorkspace}=await load('light-workspace'),{SessionJournal}=await load('session-journal');
 const root=await mkdtemp(join(tmpdir(),'blame-formatter-revision-'));
 try {
  await writeFile(join(root,'package.json'),JSON.stringify({devDependencies:{prettier:'3.0.0'}}));
  const path=variant==='markdown'?'NOTE.md':'value.ts';
  const before=variant==='markdown'?'# Note\n\nA paragraph':'export const value={value:1}\n';
  const external=variant==='markdown'?'# Changed externally\n\nA paragraph    \n':'export const value = ;\n';
  await writeFile(join(root,path),before);
  const workspace=new LightWorkspace(root,{sessionId:'formatter-revision',taskContract:{session_id:'formatter-revision',objective:'Format NOTE.md',acceptance_criteria:['formatted requested source'],effect_requirement:'source_change'}});
  const apply=workspace.edits.replaceFiles.bind(workspace.edits);
  let committedRevision,formatterOutput;
  workspace.edits.replaceFiles=async(...args)=>{
   const result=await apply(...args);assert.equal(result.status,'ok');
   committedRevision=result.data.sourceRevisionId;formatterOutput=args[0][0].content;
   await writeFile(join(root,path),external);
   return result;
  };
  const result=await workspace.tasks.run({kind:'command',command:'pnpm exec prettier --write '+path});
  const actual=await readFile(join(root,path),'utf8'),snapshot=await new SessionJournal(root,'formatter-revision').completionSnapshot();
  assert.equal(actual,external,'External change must be preserved');
  assert.notEqual(actual,formatterOutput);
  const freshPassed=snapshot.validations.filter(v=>v.status==='passed');
  rows.push({runtime,variant,result,committedRevision,formatterOutput,actual,currentRevision:snapshot.sourceRevisionId,validations:snapshot.validations,changedPaths:snapshot.changedPaths,externallyChangedSourceAdmittedAsFresh: freshPassed.length>0&&snapshot.sourceRevisionId!==committedRevision,completionNotInvoked:true,controlledInjection:'Immediately after successful real edit commit and before formatter validation; no model or invocation alteration'});
 } finally {await rm(root,{recursive:true,force:true});}
}
assert.ok(rows.length);
console.log(JSON.stringify({classification:'F2 exploratory deterministic local source-revision race replay, no model, no task completion. Actual formatter exit, journal admission and independently checked current source are distinct.',rows},null,2));
