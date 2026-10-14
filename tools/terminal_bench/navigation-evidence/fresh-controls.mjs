import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {applyOracle} from "./multifile-criteria.mjs";
import {projectVerifiers} from "./project-verifiers.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT,"fresh-zod");
const study=studyFor("f26"),protocol=JSON.parse(await readFile(join(study,"protocol.json")));
const directory=join(work,"criteria-controls");await mkdir(directory);
const rows=[];
for(const task of protocol.tasks) {
  const root=join(directory,task.id);
  execFileSync(process.execPath,[join(repo,"tools/terminal_bench/navigation-evidence/run.mjs"),"prepare","f26",root,task.id]);
  for(const state of ["unchanged","private-positive"]) {
    if(state==="private-positive") {
      if(task.kind==="multifile-rename") for(const path of task.allowedPaths) {
        const text=await readFile(join(root,path),"utf8");await writeFile(join(root,path),applyOracle(text,task.oracle.spans[path]??[],task.newName));
      } else {
        const source=join(root,"src/types.ts"),helper=join(root,"src/helpers/parseUtil.ts");
        let text=await readFile(source,"utf8"),start=text.indexOf("export class ZodRecord<"),end=text.indexOf("export class ZodMap",start);
        assert(start>=0&&end>start);const region=text.slice(start,end);
        assert.equal(region.split("for (const key in ctx.data)").length,2);
        await writeFile(source,text.slice(0,start)+region.replace("for (const key in ctx.data)","for (const key of util.objectKeys(ctx.data))")+text.slice(end));
        text=await readFile(helper,"utf8");start=text.indexOf("  static async mergeObjectAsync(");end=text.indexOf("  static mergeObjectSync(",start);
        let block=text.slice(start,end).replace("value: ParseReturnType<any> }[]","value: ParseReturnType<any>; alwaysSet?: boolean }[]")
          .replace("const syncPairs: ObjectPair[]", "const syncPairs: (ObjectPair & { alwaysSet?: boolean })[]")
          .replace("        value,\n", "        value,\n        alwaysSet: pair.alwaysSet,\n");
        assert.notEqual(block,text.slice(start,end));await writeFile(helper,text.slice(0,start)+block+text.slice(end));
      }
    }
    const output=join(directory,task.id+"-"+state);
    execFileSync(process.execPath,[join(repo,"tools/terminal_bench/navigation-evidence/run.mjs"),"score","f26",output,root,task.id]);
    const score=JSON.parse(await readFile(join(output,"score.json")));
    assert.equal(score.independentFunctionalSuccess,state==="private-positive");
    rows.push({id:task.id,state,featureChecks:score.featureChecks,selected:score.selected,types:score.types,full:score.full,independentFunctionalSuccess:score.independentFunctionalSuccess});
  }
}
assert.throws(()=>projectVerifiers({project:"unregistered"}),/explicit selected/u);
await writeFile(join(study,"criteria-controls.json"),JSON.stringify({paidRequests:0,unknownProjectRejected:true,rows,
  method:"Unchanged inputs are rejected; private locally repaired controls pass protected criteria, exact project typecheck and full suite in UTC plus feature assertions in America/New_York. Private repairs are never trial inputs or model context. Existing unmodified suite independently passes. No model efficacy is inferred."},null,2)+"\n");
console.log(JSON.stringify({paidRequests:0,criteriaControls:rows.length,negative:rows.filter(r=>!r.independentFunctionalSuccess).length,positive:rows.filter(r=>r.independentFunctionalSuccess).length}));
