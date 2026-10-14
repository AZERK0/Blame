// Register fresh criteria first; freeze one-action compiler-rename ablation only.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {join} from "node:path";
import {repo,work,studyFor} from "./campaign-paths.mjs";
import {bindingOracle} from "./multifile-criteria.mjs";
const variant=process.env.BLAME_STUDY_VARIANT;assert(["fresh-zod","native2"].includes(variant));
const panel=variant==="native2"?"f27":"f26";
const study=studyFor(panel),sha=b=>createHash("sha256").update(b).digest("hex");
const protocol=JSON.parse(await readFile(join(study,"protocol.json")));
if(process.argv[2]==="register-oracles") {
  assert.equal(protocol.status,"local-preflight-no-model-dispatch");
  for(const task of protocol.tasks) {
    const root=join(repo,protocol.upstreams[task.project].sourceRoot);
    if(task.kind==="multifile-rename") {
      task.oracle=bindingOracle(root,task);
      task.allowedPaths=Object.keys(task.oracle.spans);
    }
    task.selectedSourceSha256={};
    for(const path of task.allowedPaths.filter(p=>!task.inputFiles?.[p]))
      task.selectedSourceSha256[path]=sha(await readFile(join(root,path)));
  }
  await writeFile(join(study,"protocol.json"),JSON.stringify(protocol,null,2)+"\n");
} else if(process.argv[2]==="freeze") {
  assert.equal(protocol.status,"registered-before-model-dispatch");
  // Reuse the source-based freeze implementation, parameterized in a private
  // copy. Archive that exact driver and bind its bytes in execution-bindings.
  const original=await readFile(join(repo,"tools/terminal_bench/navigation-evidence/prepare-rename-ablation.mjs"),"utf8");
  const driver=original.replaceAll('"rename-ablation"',JSON.stringify(variant)).replaceAll('"f25"',JSON.stringify(panel));
  await mkdir(work,{recursive:true});
  const path=join(repo,"tools/terminal_bench/navigation-evidence/.fresh-freeze-driver.mjs");
  await writeFile(join(study,"freeze-driver.mjs"),driver);
  await writeFile(path,driver);
  try {execFileSync(process.execPath,[path],{cwd:repo,stdio:"inherit"});}
  finally {await import("node:fs/promises").then(fs=>fs.unlink(path));}
} else throw Error("Use register-oracles|freeze");
