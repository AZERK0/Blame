// Read-only extraction after trials. No source repairs, new scores or oracle feedback.
import { createHash } from "node:crypto";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
const campaign=resolve(process.argv[2]),study=resolve(process.argv[3]);
const json=async path=>JSON.parse(await readFile(path,"utf8"));
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const analysis=await json(join(campaign,"analysis.json"));
const ledger=await json(join(campaign,"tool-ledger.json"));
const bindings=await json(join(study,"execution-bindings.json"));
const protocol=await json(join(study,"protocol.json"));
const mechanisms=[],validation=[],addedSources=[],journals=[];
for(const row of analysis.rows){
  const task=protocol.tasks.find(t=>t.id===row.id);
  const tools=ledger.find(t=>t.name===row.name).tools;
  const searches=tools.filter(t=>t.tool==="search_code");
  const counts=new Map();for(const t of searches){const k=JSON.stringify(t.input);counts.set(k,(counts.get(k)??0)+1);}
  const rootOnly=searches.filter(t=>t.input.scope==="*" || (Array.isArray(t.input.scope)&&t.input.scope.includes("*")));
  mechanisms.push({name:row.name,id:row.id,arm:row.arm,repetition:row.repetition,
    searchCalls:searches.length,rootStarCalls:rootOnly.length,
    rootStarEmpty:rootOnly.filter(t=>t.output?.status==="ok"&&t.output?.data?.results?.length===0).length,
    emptySearches:searches.filter(t=>t.output?.status==="ok"&&t.output?.data?.results?.length===0).length,
    blockedSearches:searches.filter(t=>t.output?.status==="blocked").length,
    repeatedIdenticalSearchInputs:[...counts.values()].reduce((n,c)=>n+Math.max(0,c-1),0),
    readCalls:tools.filter(t=>t.tool==="read_code"||t.tool==="read_files").length,
    signatureRequests:tools.filter(t=>t.tool==="read_code"&&t.input.view==="signature").length,
    signatureRendered:tools.filter(t=>t.tool==="read_code"&&t.output?.data?.bodyOmitted===true).length,
    scopedRecoveryHints:tools.filter(t=>t.tool==="edit_code"&&JSON.stringify(t.output).includes("declarationLines")).length,
    activeCaseCaptions:tools.filter(t=>t.tool==="run_task"&&JSON.stringify(t.output).includes("Active Node case results:")).length,
    readTargets:tools.filter(t=>t.tool==="read_code"||t.tool==="read_files")
      .reduce((n,t)=>n+(t.tool==="read_files"?(t.input.files?.length??0):1),0),
    nativeRenameCalls:row.semanticRenameCalls,compilerReferenceCalls:row.semanticReferenceCalls,
    blockedEdits:tools.filter(t=>t.tool==="edit_code"&&t.output?.status==="blocked").length,
    searchInputs:searches.map(t=>({input:t.input,status:t.output?.status,resultCount:t.output?.data?.results?.length??null})),
    eventsSha256:row.eventsSha256});
  const score=await json(join(campaign,row.name,"score.json"));
  const journalEvents=[];
  const journalRoot=join(campaign,row.name,"workspace/.blame/harness/light");
  try{
    for(const name of (await readdir(journalRoot)).filter(n=>n.endsWith(".jsonl")).sort()){
      const bytes=await readFile(join(journalRoot,name));
      journalEvents.push(...bytes.toString().split("\n").filter(Boolean).map(JSON.parse));
      const artifact="journals/"+row.name+"."+name+".gz";
      await mkdir(join(study,"journals"),{recursive:true});
      await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}));
      journals.push({name:row.name,file:name,artifact,bytes:bytes.length,sha256:sha(bytes)});
    }
  }catch(error){if(error.code!=="ENOENT")throw error;}
  const rawNpm=tools.filter(t=>t.tool==="run_task"&&t.input.kind==="command"&&/^npm (?:test|run [^ ]+) -- /u.test(t.input.command));
  const classified=journalEvents.filter(e=>e.type==="validation"&&e.taskKind==="test"&&e.taskId&&rawNpm.some(t=>t.input.command===e.command));
  Object.assign(mechanisms.at(-1),{
    rawNpmCalls:rawNpm.length, classifiedRawNpmInvocations:classified.length,
    classifiedInvocations:classified.map(e=>({id:e.id,command:e.command,taskId:e.taskId,args:e.args??[],sourceRevisionId:e.sourceRevisionId,status:e.status,check:e.check})),
    automaticValidationInputs:tools.filter(t=>t.tool==="run_task"&&String(t.toolCall?.id??t.toolCallId??"").includes(":validation")).map(t=>t.input),
  });
  const addedPath=task.newTest ?? task.reportFile;
  if(addedPath){
    try{
      const bytes=await readFile(join(campaign,row.name,"workspace",addedPath));
      if(sha(bytes)!==score.sourceSha256[addedPath])throw new Error("Scored added source changed");
      addedSources.push({name:row.name,path:addedPath,kind:task.reportFile?"requested-report":"added-test",sha256:sha(bytes),bytes:bytes.length,encoding:"base64",content:bytes.toString("base64")});
    }catch(error){if(error.code!=="ENOENT")throw error;addedSources.push({name:row.name,path:addedPath,missing:true});}
  }
  const calls=tools.filter(t=>t.tool==="run_task"||t.tool==="run_commands").map(t=>{
    const data=t.output?.data;
    const completed=data?.completed?.data;
    return {tool:t.tool,input:t.input,reportedStatus:t.output?.status??null,run:data?.run??null,
      command:completed?.command??data?.command??null,
      observedExitCode:completed?.exitCode??data?.exitCode??null,
      process:data?.process??null,reportedEnvironment:completed?.environment??data?.environment??null,
      admittedValidation:completed?.validation??data?.validation??null,
      nativeResults:t.tool==="run_commands"?t.output:null};
  });
  validation.push({name:row.name,eventsSha256:row.eventsSha256,scoreSha256:row.scoreSha256,
    finalScoredSources:score.sourceSha256,actualRecordedAgentCommands:calls,
    officialRuntimeSuccess:row.officialRuntimeSuccess,
    completionAsReported:row.completion,
    independent:{feature:score.featureInvocation,nonUtcFeature:score.nonUtcFeatureInvocation,
      selected:score.selected,typesOrSyntax:score.types,fullDefinedSuite:score.full,
      addedTests:score.addedTests,addedTestsOnOriginalSource:score.testCounterexample},
    boundEnvironment:{node:bindings.node,project:bindings.projects[task.project],
      defaultTZ:"UTC",secondFeatureTZ:"America/New_York",runtime:bindings.versions[row.arm==="modified" ||
       (row.arm==="cline"&&protocol.clineRuntimeArm==="modified")?"modified":"baseline"]},
    independentFunctionalSuccess:score.independentFunctionalSuccess,
    limitation:"Configured verifier environment is reconstructed from frozen code and bindings. Agent commands carry only actually observed exit/status/admission fields. Missing test-scope admission stays unknown; manual post-final-edit invocation and full criteria review remain mandatory."});
}
await writeFile(join(study,"mechanism-analysis.json"),JSON.stringify({
  method:protocol.studyKind === "declaration-navigation"
    ? "Finished-tool observations only, SHA-bound to raw events. F24 changes only bounded exact declaration ranking; compiler references/rename, schemas, prompts and validation are common to both Light arms. Distinguish requested search modes, actual activation, executed commands, admission and final-report criteria. No activation establishes no ranking efficacy; resources of the whole Light route versus native SDK do not isolate the compiler mechanism."
    : "Finished-tool observations only, SHA-bound to raw events. F21 changes only bounded rejection recovery; F22 only signature availability; F23 only the appended active-case caption, with identical structured Node evidence in both arms. Requested and rendered views differ. Record invocation IDs, admission and missing obligations separately. No natural mechanism activation means no effectiveness conclusion. Repeated inputs or empty queries are not automatically errors.",rows:mechanisms},null,2)+"\n");
await writeFile(join(study,"validation-provenance.json"),JSON.stringify({
  bindingSha256:sha(await readFile(join(study,"execution-bindings.json"))),
  protocolSha256:sha(await readFile(join(study,"protocol.json"))),rows:validation},null,2)+"\n");
// git diff excludes untracked new files. Preserve them separately, never amend
// the original recorded workspace.diff or its endpoint hash.
const addedArtifact=gzipSync(JSON.stringify({method:"Unchanged final requested reports or added tests, matched to frozen score source hashes. Supplement the original tracked diff; no model source repair. Historical artifact filename retained for compatibility; source kind is explicit.",sources:addedSources}),{mtime:0});
await writeFile(join(study,"added-test-sources.json.gz"),addedArtifact);
await writeFile(join(study,"supplemental-inventory.json"),JSON.stringify({artifact:"added-test-sources.json.gz",sha256:sha(addedArtifact),sources:addedSources.map(({content,...metadata})=>metadata),journals},null,2)+"\n");
console.log(JSON.stringify({completed:analysis.completed,planned:analysis.planned,mechanisms:mechanisms.map(({name,searchCalls,rootStarCalls})=>({name,searchCalls,rootStarCalls}))}));
