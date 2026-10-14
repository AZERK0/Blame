// Local SDK diagnostic after the cohort; no paid trials or dependency edits.
import assert from "node:assert/strict";
import {readFile,writeFile,mkdir,realpath} from "node:fs/promises";
import {join,dirname} from "node:path";
import {pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {repo,work,studyFor} from "./campaign-paths.mjs";
const spaced=process.argv[2]==="spaced";
const study=studyFor("f26"),root=join(work,spaced?"sdk-search-control-spaced":"sdk-search-control-5");await mkdir(root);
await writeFile(join(root,"a.ts"),'const beforeA = 1;\nconst needle = 1;\nconst middleA = 1;\nconst needleAgain = needle;\n'+(spaced?'// gap one\n// gap two\n// gap three\nconst needleLate = needle;\n':''));
await writeFile(join(root,"b.ts"),'const beforeB = "SECOND_FILE_CONTEXT";\nconst needle = 2;\nconst afterB = "SECOND_FILE_AFTER";\n');
// Match the paid workspaces' own Git root for this local diagnostic.
execFileSync("git",["init","--quiet"],{cwd:root});
const sdk=await realpath(join(repo,"packages/agent-runtime/node_modules/@cline/sdk/package.json"));
const core=await realpath(join(dirname(sdk),"../core/dist/index.js"));
const {createDefaultExecutors}=await import(pathToFileURL(core));assert.equal(typeof createDefaultExecutors,"function");
const search=createDefaultExecutors({search:{maxResults:100,contextLines:2}}).search;assert.equal(typeof search,"function");
const actual=await search("needle",root,{signal:new AbortController().signal});
const exhaustive=execFileSync("rg",["--json","--context=2","-i","needle","."],{cwd:root,encoding:"utf8"});
const expected=exhaustive.trim().split("\n").map(JSON.parse).filter(e=>e.type==="match").map(e=>({file:e.data.path.text,line:e.data.line_number,submatches:e.data.submatches.length}));
const headers=[...actual.matchAll(/^([^\n]+\.ts):(\d+):(\d+)$/gmu)].map(m=>({file:m[1],line:Number(m[2])}));
const lines=actual.split("\n"),problems=[];let file=null;
for(const line of lines) {
  const header=/^([^\n]+\.ts):(\d+):(\d+)$/u.exec(line);if(header){file=header[1];continue;}
  const context=/^[ >] (\d+): (.*)$/u.exec(line);
  if(context&&file) {
    const source=(await readFile(join(root,file),"utf8")).split("\n")[Number(context[1])-1];
    if(context[2].trimEnd()!==source)problems.push({headerFile:file,line:Number(context[1]),presented:context[2],actual:source??null});
  }
}
const output={paidRequests:0,spaced,sdkVersion:JSON.parse(await readFile(sdk)).version,
  setupNotes:["First local setup used a declaration-only export unavailable at the core entrypoint; use public createDefaultExecutors().search.","Intermediate setups used an overescaped regex and an exhaustive rg command with piped stdin/no explicit path, which searched empty stdin. Correct both, preserve all failed setups, and use an explicit dot for exhaustive search. Zero model calls; earlier ignore-related conjecture is not established."],
  coreSha256:createHash("sha256").update(await readFile(core)).digest("hex"),actualSdkOutput:actual,
  exhaustiveRgMatches:expected,actualSdkMatchHeaders:headers,sourceContextMismatches:problems,
  mechanism:"Current SDK ripgrep fast path passes --max-count=1 (per file), omits match-line text, and attaches context records to the preceding match without checking the context file. This is an information/formatting defect in SDK0.0.82, not a model-only decision. The paid native migration's six-result search similarly undersamples75consumer references and mixes snippet filenames. No fixed SDK or model benefit is measured; preserve the original native outcome/cost.",
  observations:{completeMatchingLines:expected.length,renderedMatchHeaders:headers.length,contextMismatches:problems.length}};
await writeFile(join(study,spaced?"sdk-search-controls-spaced.json":"sdk-search-controls.json"),JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({paidRequests:0,...output.observations}));
