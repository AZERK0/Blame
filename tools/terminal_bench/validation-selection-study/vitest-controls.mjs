// Actual pinned runner controls, separate from the unchanged endpoint replay.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {dependencyRoot,repo,sha} from '../validation-scope-study/setup.mjs';
const runtime=resolve(process.argv[2]??join(repo,'packages/agent-runtime/dist/harness'));
const runtimeHashes={};for(const file of ['check-observation.js','light-task-runner.js','light-finish-service.js','light-validation-report.js'])runtimeHashes[file]=sha(await readFile(join(runtime,file)));
const researcherCodeCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const {LightWorkspace}=await import(pathToFileURL(join(runtime,'light-workspace.js')));
const {LightFinishService}=await import(pathToFileURL(join(runtime,'light-finish-service.js')));
const {SessionJournal}=await import(pathToFileURL(join(runtime,'session-journal.js')));
const root=await mkdtemp(join(tmpdir(),'blame-f45-vitest-'));
try{
 await symlink(join(dependencyRoot,'node_modules'),join(root,'node_modules'));await mkdir(join(root,'src'));
 await writeFile(join(root,'package.json'),JSON.stringify({type:'module',scripts:{test:'node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism'}}));
 await writeFile(join(root,'src/fail.test.ts'),"import{test,expect}from'vitest';test('real assertion',()=>expect(1).toBe(2));\n");
 await writeFile(join(root,'src/pass.test.ts'),"import{test,expect}from'vitest';test('real pass',()=>expect(1).toBe(1));\n");
 const gap="import{test,expect}from'vitest';const value:number='wrong type';test('runtime only',()=>expect(value).toBe('wrong type'));\n";
 await writeFile(join(root,'src/type-gap.test.ts'),gap);
 const workspace=new LightWorkspace(root,{sessionId:'real-controls'});
 assert.equal((await workspace.editCode({operations:[{kind:'patch',path:'src/new.js',patch:'export const added = true;\n'}]})).status,'ok');
 const missing=await workspace.runTask({kind:'project',task:'test',args:['absent.test.ts']},{});
 const failure=await workspace.runTask({kind:'project',task:'test',args:['src/fail.test.ts']},{});
 const passing=await workspace.runTask({kind:'project',task:'test',args:['src/pass.test.ts']},{});
 assert.equal(missing.data.failure.category,'command');assert.equal(failure.data.failure.category,'code');assert.equal(failure.data.check.counts.failed,1);assert.equal(passing.data.check.outcome,'passed');
 const finish=new LightFinishService({workspaceRoot:root,conversationId:'real-controls'});let finishError;
 try{await finish.finish('One selected test passed.',{});}catch(e){finishError=e.message;}
 assert.match(finishError,/still failing/);
 const run=args=>{const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',timeout:30000});return{args,exitCode:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr};};
 const typeGapVitest=run(['node_modules/vitest/vitest.mjs','run','src/type-gap.test.ts','--maxWorkers=1','--typecheck.enabled','--typecheck.ignoreSourceErrors']);
 const typeGapCompiler=run(['node_modules/typescript/bin/tsc','--noEmit','--strict','--target','ES2022','--module','ESNext','--moduleResolution','Bundler','--skipLibCheck','src/type-gap.test.ts']);
 assert.equal(typeGapVitest.exitCode,0);assert.match(typeGapVitest.stdout,/Type Errors\s+no errors/);assert.equal(typeGapCompiler.exitCode,2);assert.match(typeGapCompiler.stdout,/TS2322/);
 const result={modelRequests:0,method:'Fresh local fixtures with pinned Vitest3.2.4/TypeScript5.9.3. Genuine assertion failure remains blocking after another selector passes. Separate post-hoc type-gap control demonstrates that Type Errors no errors is not proof a runtime test was typechecked.',runtime,runtimeHashes,researcherCodeCommit,vitestVersion:JSON.parse(await readFile(join(root,'node_modules/vitest/package.json'))).version,missing,failure,passing,finishError,journal:await new SessionJournal(root,'real-controls').completionSnapshot(),typeGap:{source:gap,sha256:sha(gap),vitest:typeGapVitest,compiler:typeGapCompiler}};
 for(const [file,hash]of Object.entries(runtimeHashes))assert.equal(sha(await readFile(join(runtime,file))),hash,'Runtime changed during replay');
const output=resolve(process.argv[3]);await writeFile(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({output,realAssertionBlocked:true,typeGapConfirmed:true}));
}finally{await rm(root,{recursive:true,force:true});}
