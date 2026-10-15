import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
import {positive} from './positive.mjs';
const protocol=JSON.parse(await readFile(join(study,'protocol.json'))),rows=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
function run(argv,cwd=repo){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});return{argv,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''};}
for(const task of protocol.tasks){
 const root=join(work,'controls',task.id);await mkdir(join(root,'..'),{recursive:true});
 const prep=run([process.execPath,join(repo,'tools/terminal_bench/concise-study/run.mjs'),'prepare','f30',root,task.id]);assert.equal(prep.exitCode,0,prep.stderr);
 const feature=()=>run([process.execPath,join(repo,'tools/terminal_bench/concise-study/features.mjs'),root,task.id]);
 const unchanged={feature:feature(),selected:run(task.verifierCommands.selected,root)};assert.equal(unchanged.feature.exitCode,1);assert.equal(unchanged.selected.exitCode,1);
 await positive(root,task.kind);
 const authoredHashes=Object.fromEntries(await Promise.all(task.allowedPaths.map(async p=>[p,sha(await readFile(join(root,p)))])));
 const pass={feature:feature(),selected:run(task.verifierCommands.selected,root),types:run(task.verifierCommands.types,root),full:run(task.verifierCommands.full,root)};
 await writeFile(join(work,task.id+'-control-progress.json'),JSON.stringify({unchanged,positive:pass},null,2)+'\n');
 for(const c of Object.values(pass))assert.equal(c.exitCode,0,c.stderr+'\n'+c.stdout);
 assert.match(pass.full.stderr,/Test Suites:\s+108 passed, 108 total/u);assert.match(pass.full.stderr,/Tests:\s+1206 passed, 1206 total/u);
 const mutants=[];
 async function mutate(path,before,after,label){const p=join(root,path),original=await readFile(p,'utf8');assert(original.includes(before),label);try{await writeFile(p,original.replace(before,after));const result=feature();assert.equal(result.exitCode,1,label);const failures=JSON.parse(result.stdout).checks.filter(c=>!c.passed);assert(failures.length>0);mutants.push({label,path,failedChecks:failures.map(c=>c.name),result});}finally{await writeFile(p,original);}}
 if(task.kind==='choices'){
  await mutate('lib/option.js','config?.caseInsensitive === true','!!config?.caseInsensitive','non-true flag must remain case-sensitive');
  await mutate('lib/argument.js','return this._concatValue(value, previous);','return [value];','variadic hook must remain observable');
  await mutate('typings/index.d.ts','config?: {caseInsensitive?: boolean} | null','config?: any','invalid type input must remain rejected');
 }else if(task.kind==='hidden-arguments'){
  await mutate('lib/help.js','if (visible.find((argument) => argument.description))','if (cmd.registeredArguments.find((argument) => argument.description))','hidden description must not enable table');
  await mutate('lib/argument.js','this.hidden = !!hide;','this.hidden = true;','hideHelp false must reverse');
 }else{
  await mutate('lib/command.js','.find(name => name in process.env);','.find(name => !!process.env[name]);','empty selected environment value must remain present');
  await mutate('lib/command.js',"from env '${envVar}' is invalid.","from env '${option.envVar}' is invalid.",'error must name selected fallback');
  await mutate('lib/command.js','process.env[envVar]);','process.env[envVar], envVar);','public optionEnv event argument count must stay unchanged');
 }
 const protectedPath=Object.keys(task.inputFiles)[0],original=await readFile(join(root,protectedPath));await writeFile(join(root,protectedPath),Buffer.concat([original,Buffer.from('\n// mutation\n')]));const protectedNegative=feature();await writeFile(join(root,protectedPath),original);assert.equal(protectedNegative.exitCode,1);assert(JSON.parse(protectedNegative.stdout).checks.some(c=>c.name.startsWith('protected-input:')&&!c.passed));
 rows.push({id:task.id,kind:task.kind,unchanged,authoredPositiveSourceSha256:authoredHashes,positive:pass,mutants,protectedNegative});
}
await writeFile(join(study,'task-controls.json'),JSON.stringify({paidRequests:0,method:'Every unchanged input fails requested behavior; independently authored positives pass supplied and private behavior/type probes plus all108 upstream suites and both JS/TS checks. Targeted behavior,type and protected-input mutants are rejected before model dispatch. Controls never supplied as solutions.',rows},null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'project-controls.json'),JSON.stringify({paidRequests:0,upstream:{project:'commander',version:'13.1.0'},artifact:'task-controls.json',sha256:sha(await readFile(join(study,'task-controls.json'))),baselineSuites:108,baselineTests:1206,allPositiveSuitesPass:true,knownLauncherFailuresRetained:true},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,tasks:rows.length,mutants:rows.reduce((n,r)=>n+r.mutants.length,0),allExpectedControlsPass:true}));
