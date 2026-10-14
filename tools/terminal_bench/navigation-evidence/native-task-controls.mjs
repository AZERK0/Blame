// Private positive/negative controls, never model workspace repair.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";
import {execFileSync,spawnSync} from "node:child_process";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {applyOracle} from "./multifile-criteria.mjs";
const study=studyFor("f27"),protocol=JSON.parse(await readFile(join(study,"protocol.json"))),directory=join(work,"task-controls-scoped");await mkdir(directory);
const rows=[];
for(const task of protocol.tasks) {
 const root=join(directory,task.id);execFileSync(process.execPath,[join(repo,"tools/terminal_bench/navigation-evidence/run.mjs"),"prepare","f27",root,task.id]);
 for(const state of ["unchanged","private-positive"]) {
  if(state==="private-positive") {
   if(task.kind==="multifile-rename") for(const path of task.allowedPaths)await writeFile(join(root,path),applyOracle(await readFile(join(root,path),"utf8"),task.oracle.spans[path]??[],task.newName));
   else if(task.kind==="record-presence") {
    const path=join(root,"src/types.ts"),text=await readFile(path,"utf8"),start=text.indexOf("export class ZodRecord<"),end=text.indexOf("export class ZodMap",start);
    await writeFile(path,text.slice(0,start)+text.slice(start,end).replace("for (const key in ctx.data)","for (const key of util.objectKeys(ctx.data))")+text.slice(end));
    const helper=join(root,"src/helpers/parseUtil.ts");let h=await readFile(helper,"utf8");
    h=h.replace("  value: SyncParseReturnType<any>;\n};","  value: SyncParseReturnType<any>;\n  alwaysSet?: boolean;\n};")
     .replace("pairs: { key: ParseReturnType<any>; value: ParseReturnType<any> }[]","pairs: { key: ParseReturnType<any>; value: ParseReturnType<any>; alwaysSet?: boolean }[]")
     .replace("        value,\n","        value,\n        alwaysSet: pair.alwaysSet,\n");await writeFile(helper,h);
   } else {
    const helper=join(root,"src/internal/util/isReadableStreamLike.ts");let h=await readFile(helper,"utf8");
    h=h.replace("  const reader = readableStream.getReader();","  const reader = readableStream.getReader();\n  let exhausted = false;")
     .replace("      if (done) {\n        return;","      if (done) {\n        exhausted = true;\n        return;")
     .replace("    reader.releaseLock();","    try { if (!exhausted) await reader.cancel?.(); } finally { reader.releaseLock(); }");await writeFile(helper,h);
    const types=join(root,"src/internal/types.ts");await writeFile(types,(await readFile(types,"utf8")).replace("  releaseLock(): void;","  releaseLock(): void;\n  cancel?(reason?: any): PromiseLike<void>;"));
    const scheduler=join(root,"src/internal/scheduled/scheduleAsyncIterable.ts"),original=await readFile(scheduler,"utf8"),start=original.indexOf("  return new Observable<T>"),end=original.lastIndexOf("\n}");
    const body=`  return new Observable<T>((subscriber) => {
    let iterator: AsyncIterator<T> | undefined;
    let exhausted = false;
    let returned = false;
    subscriber.add(() => {
      if (!exhausted && !returned && iterator?.return) {
        returned = true;
        try { Promise.resolve(iterator.return()).then(undefined, () => {}); } catch (_) {}
      }
    });
    executeSchedule(subscriber, scheduler, () => {
      iterator = input[Symbol.asyncIterator]();
      const pull = () => {
        if (subscriber.closed) return;
        try {
          iterator!.next().then((result) => {
            if (subscriber.closed) return;
            if (result.done) {
              exhausted = true;
              // This will remove the subscriptions from
              // the parent subscription.
              subscriber.complete();
            } else {
              subscriber.next(result.value);
              if (!subscriber.closed) executeSchedule(subscriber, scheduler, pull);
            }
          }, (error) => subscriber.error(error));
        } catch (error) { subscriber.error(error); }
      };
      executeSchedule(subscriber, scheduler, pull);
    });
  });`;
    await writeFile(scheduler,original.slice(0,start)+body+original.slice(end));
   }
  }
  const output=join(directory,task.id+"-"+state);
  execFileSync(process.execPath,[join(repo,"tools/terminal_bench/navigation-evidence/run.mjs"),"score","f27",output,root,task.id]);
  const score=JSON.parse(await readFile(join(output,"score.json")));assert.equal(score.independentFunctionalSuccess,state==="private-positive",JSON.stringify({task:task.id,state,failed:score.featureChecks.filter(c=>!c.passed),types:score.types,full:score.full.exitCode}));
  rows.push({id:task.id,state,score});
 }
 if(task.kind!=="multifile-rename") {
  const path=join(root,task.allowedPaths[0]),saved=await readFile(path,"utf8");await writeFile(path,saved+"\nexport const unrelatedScopeProbe = 1;\n");
  const result=spawnSync(process.execPath,[join(repo,"tools/terminal_bench/navigation-evidence/feature-checks.mjs"),root,task.id,study],{encoding:"utf8",timeout:10000});
  assert.equal(result.status,1);assert(JSON.parse(result.stdout).checks.some(c=>c.name.startsWith("registered-source-integrity:")&&!c.passed));
  await writeFile(path,saved);
 }
}
await writeFile(join(study,"task-controls.json"),JSON.stringify({paidRequests:0,rows,unrelatedBehaviorEditsRejected:2,
 method:"All four unchanged tasks fail; private positive migrations and two cross-file behavior repairs pass original/supplied assertions,explicit typecheck,full suite and UTC/non-UTC probes. Optional ObjectPair flag now accepted only through new opt-in; unrelated source edits rejected. Private positives never become model inputs. No paid efficacy is inferred."},null,2)+"\n");
console.log(JSON.stringify({paidRequests:0,controls:rows.length,positives:rows.filter(r=>r.score.independentFunctionalSuccess).length}));
