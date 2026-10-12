// Counterfactual diagnostic executions on unchanged agent-produced final source.
// Never edit the original campaign, replay its scores, or feed results to a model.
import { cp, mkdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
const repo=resolve(new URL("../../..",import.meta.url).pathname);
const sourceRoot=join(repo,".blame/research/required-validation/diagnostic");
const out=join(repo,".blame/research/required-validation/npm-report-replay");
await mkdir(out); // Refuse overwrite.
const modules={
  reference:join(repo,".blame/research/required-validation/f16-reference-source/packages/agent-runtime/dist/harness"),
  candidate:join(repo,"packages/agent-runtime/dist/harness"),
};
const protocol=JSON.parse(await readFile(join(repo,"docs/experiments/light-harness-required-checks-diagnostic-2026-10-12/protocol.json"),"utf8"));
const task=protocol.tasks[0];
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const rows=[];
for(const trial of ["1-date-fns-same-day-bug-baseline","2-date-fns-same-day-bug-modified"]){
  const source=join(sourceRoot,trial,"workspace");
  const score=JSON.parse(await readFile(join(sourceRoot,trial,"score.json"),"utf8"));
  for(const [arm,modulesRoot] of Object.entries(modules)){
    const root=join(out,trial,arm);await mkdir(join(root,".."),{recursive:true});
    await cp(source,root,{recursive:true,filter:path=>!path.slice(source.length).split("/").some(p=>p==="node_modules"||p===".blame")});
    await symlink(join(repo,".blame/research/npm-formatter-confirmation/date-fns/node_modules"),join(root,"node_modules"));
    const {LightTaskRunner}=await import(join(modulesRoot,"light-task-runner.js"));
    const {LightFinishService}=await import(join(modulesRoot,"light-finish-service.js"));
    const {WorkspaceFiles}=await import(join(modulesRoot,"workspace-files.js"));
    const {SessionJournal}=await import(join(modulesRoot,"session-journal.js"));
    const files=new WorkspaceFiles(root),journal=new SessionJournal(root,"report-replay");
    const before=(await files.snapshot()).revision.source_revision_id;
    const runner=new LightTaskRunner({files,journal});
    const commands=["npm run types","npm test -- "+task.requiredChecks[1].args.join(" ")];
    const results=[];
    for(const command of commands) results.push(await runner.run({kind:"command",command},{}));
    const notifications=[],activities=[];
    const finish=new LightFinishService({workspaceRoot:root,conversationId:"report-replay",
      taskContract:{required_checks:task.requiredChecks},onComplete:n=>notifications.push(n),onValidationActivity:a=>activities.push(a)});
    await finish.finish("Mechanical invocation replay only",{});
    const state=await journal.completionSnapshot();
    if(state.sourceRevisionId!==before)throw Error("Replay source changed");
    for(const [path,expected] of Object.entries(score.sourceSha256))
      if(sha(await readFile(join(root,path)))!==expected)throw Error("Original scored source changed: "+path);
    rows.push({trial,arm,commands,results,validations:state.validations,completion:notifications.at(-1),
      automaticActivities:activities,sourceUnchanged:true,sourceRevisionId:before,originalScoredSources:score.sourceSha256,
      originalEventsSha256:sha(await readFile(join(sourceRoot,trial,"events.jsonl")))});
  }
}
await writeFile(join(out,"results.json"),JSON.stringify({
  method:"Two known F15 attribution diagnostics; same unchanged final model-produced source and exact required raw npm invocations, freshly executed on F16 versus F17 modules. No changes to original model traces, source, scores or strict admission. This is a mechanical counterfactual, not a new model-success result. Test scope/selection/freshness remain unknown, including after execution IDs are fulfilled.",
  modules:await Promise.all(Object.entries(modules).map(async([arm,path])=>({arm,taskRunnerSha256:sha(await readFile(join(path,"light-task-runner.js"))),finishSha256:sha(await readFile(join(path,"light-finish-service.js"))),observerSha256:sha(await readFile(join(path,"check-observation.js")))}))),rows
},null,2)+"\n");
console.log(JSON.stringify(rows.map(row=>({trial:row.trial,arm:row.arm,tests:row.validations.find(v=>v.taskKind==="test")?.check,obligations:row.completion.completion.satisfied_obligations}))));
