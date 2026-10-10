import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const runtime=resolve(process.argv[2]), output=resolve(process.argv[3]);
const { LightWorkspace }=await import(pathToFileURL(join(runtime,'harness/light-workspace.js')));
const root=await mkdtemp(join(tmpdir(),'blame-package-selector-'));
try {
 await mkdir(join(root,'apps/web'),{recursive:true});
 await writeFile(join(root,'package.json'),JSON.stringify({scripts:{build:'node -e "console.log(\'root check executed\')"'}}));
 await writeFile(join(root,'apps/web/package.json'),JSON.stringify({scripts:{build:'node -e "process.exit(9)"'}}));
 const workspace=new LightWorkspace(root,{sessionId:'package-selector-replay'}),rows=[];
 for(const packagePath of ['.','./','package.json','./package.json','apps/web','apps/web/package.json']) {
  const input={kind:'project',task:'build',packagePath};const result=await workspace.runTask(input,{});
  rows.push({input,result});
 }
 const result={runtime,node:process.version,model:false,selection:'Local diagnosis after observing known package.json selector refusal; no solution or benchmark evaluator input.',runnerSourceSha256:createHash('sha256').update(await readFile(join(runtime,'harness/light-task-runner.js'))).digest('hex'),rows};
 await writeFile(output,JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(rows.map(({input,result})=>({packagePath:input.packagePath,status:result.status,message:result.message??null,exitCode:result.data?.exitCode??null}))));
}finally{await rm(root,{recursive:true,force:true});}
