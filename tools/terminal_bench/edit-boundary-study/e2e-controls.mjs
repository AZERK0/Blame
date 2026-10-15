// Add the project's separately named original E2E suite before dispatch.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp,symlink,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {tasks} from './tasks.mjs';
import {repo,study,work} from './paths.mjs';
const json=async n=>JSON.parse(await readFile(join(study,n))),p=await json('protocol.json');assert.equal(p.readyForModel,false);
try{await writeFile(join(study,'preparation/task-selection-before-e2e.json'),await readFile(join(study,'task-selection.json')),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
const selection=await json('task-selection.json');selection.tasks=tasks;selection.finalPreparationAtUTC=new Date().toISOString();
await writeFile(join(study,'task-selection.json'),JSON.stringify(selection,null,2)+'\n');
p.tasks=tasks;if(!p.driverInputs.includes('e2e-controls.mjs'))p.driverInputs.push('e2e-controls.mjs');if(!p.environmentArtifacts.includes('docs/experiments/light-harness-edit-boundaries-f31-2026-10-16/audit-policy.md'))p.environmentArtifacts.push('docs/experiments/light-harness-edit-boundaries-f31-2026-10-16/audit-policy.md');
await writeFile(join(study,'protocol.json'),JSON.stringify(p,null,2)+'\n');
const controls=await json('task-controls.json'),row=controls.rows.find(r=>r.id==='fast-glob-dynamic-filter'),argv=tasks.find(t=>t.project==='fast-glob').verifierCommands.e2e;
function run(cwd){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,TZ:'UTC'}});return{argv,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''};}
const pristine=await mkdtemp(join(work,'pristine-e2e-'));
try{
 const archive=gunzipSync(await readFile(join(study,'preparation/fast-glob-source.tar.gz')));
 assert.equal(spawnSync('tar',['-xf','-','-C',pristine],{input:archive}).status,0);
 await symlink(join(work,'upstreams/fast-glob/node_modules'),join(pristine,'node_modules'),'dir');
 const build=spawnSync('npm',['run','compile'],{cwd:pristine,encoding:'utf8',timeout:120000});assert.equal(build.status,0,build.stdout+build.stderr);
 row.unchanged.e2e=run(pristine);
}finally{await rm(pristine,{recursive:true,force:true});}
row.positive.e2e=run(join(work,'controls',row.id));
assert.equal(row.unchanged.e2e.exitCode,0,row.unchanged.e2e.stderr+row.unchanged.e2e.stdout);assert.equal(row.positive.e2e.exitCode,0,row.positive.e2e.stderr+row.positive.e2e.stdout);
await writeFile(join(study,'task-controls.json'),JSON.stringify(controls,null,2)+'\n');
const project=await json('project-controls.json');project.taskControlsSha256=createHash('sha256').update(await readFile(join(study,'task-controls.json'))).digest('hex');await writeFile(join(study,'project-controls.json'),JSON.stringify(project,null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,originalE2ePassed:true}));
