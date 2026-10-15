import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
import {positive} from './positive.mjs';
const protocol=JSON.parse(await readFile(join(study,'protocol.json'))),rows=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
function run(argv,cwd=repo){const r=spawnSync(argv[0],argv.slice(1),{cwd,encoding:'utf8',timeout:120000,maxBuffer:12*1024*1024,env:{...process.env,TZ:'UTC'}});return{argv,exitCode:r.status,error:r.error?.code??null,stdout:r.stdout??'',stderr:r.stderr??''};}
for(const task of protocol.tasks){
 const root=join(work,'controls',task.id);await mkdir(join(root,'..'),{recursive:true});
 const prep=run([process.execPath,join(repo,'tools/terminal_bench/edit-boundary-study/run.mjs'),'prepare','f31',root,task.id]);assert.equal(prep.exitCode,0,prep.stderr);
 const feature=()=>run([process.execPath,join(repo,'tools/terminal_bench/edit-boundary-study/features.mjs'),root,task.id]);
 const unchanged={build:run(task.verifierCommands.build,root),feature:feature(),selected:run(task.verifierCommands.selected,root),full:run(task.verifierCommands.full,root)};
 assert.equal(unchanged.feature.exitCode,1);assert.equal(unchanged.selected.exitCode,1);
 await positive(root,task.id);
 const pass={build:run(task.verifierCommands.build,root),feature:feature(),selected:run(task.verifierCommands.selected,root),types:run(task.verifierCommands.types,root),full:run(task.verifierCommands.full,root)};
 const progress={id:task.id,unchanged,positive:pass};await writeFile(join(work,task.id+'-control-progress.json'),JSON.stringify(progress,null,2)+'\n');
 for(const [key,c]of Object.entries(pass))assert.equal(c.exitCode,0,key+': '+c.stderr+'\n'+c.stdout);
 const hashes=Object.fromEntries(await Promise.all(task.allowedPaths.map(async p=>[p,sha(await readFile(join(root,p)))]))),mutants=[];
 async function mutate(path,before,after,label){const p=join(root,path),original=await readFile(p,'utf8');assert(original.includes(before),label);try{
  await writeFile(p,original.replaceAll(before,after));const build=run(task.verifierCommands.build,root),result=feature(),selected=run(task.verifierCommands.selected,root);
  assert(build.exitCode!==0||result.exitCode!==0||selected.exitCode!==0,label+' silently accepted');mutants.push({label,path,build,result,selected});
 }finally{await writeFile(p,original);}}
 if(task.project==='yaml'){
  await mutate('src/compose/compose-node.ts','anchor.offset + anchor.source.length','anchor.offset + anchor.source.length - 1','exclusive token end includes full name');
  await mutate('src/nodes/Node.ts','if (this.anchorRange) copy.anchorRange = [...this.anchorRange]','// deliberately shared tuple','clone must not share annotation tuple');
 }else{
  await mutate('src/providers/filters/deep.ts','(!this._settings.filter || this._settings.filter(entry))','true','rejected directories must not be visited');
  await mutate('src/providers/filters/entry.ts','isMatched && this._settings.filter && !this._settings.filter(entry)','false','callback must filter output entries');
 }
 assert.equal(run(task.verifierCommands.build,root).exitCode,0);
 const protectedPath=Object.keys(task.inputFiles)[0],file=join(root,protectedPath),original=await readFile(file);await writeFile(file,Buffer.concat([original,Buffer.from('\n// mutation\n')]));const protectedNegative=feature();await writeFile(file,original);assert.equal(protectedNegative.exitCode,1);
 rows.push({...progress,authoredPositiveSourceSha256:hashes,mutants,protectedNegative});console.log(JSON.stringify({id:task.id,controlsPassed:true}));
}
await writeFile(join(study,'task-controls.json'),JSON.stringify({paidRequests:0,method:'Unchanged-source behavior negatives,independently authored positives with full original suites/type checks,and targeted behavior/protected-input mutations before model dispatch. No model receives controls or verifier feedback.',rows},null,2)+'\n',{flag:'wx'});
await writeFile(join(study,'project-controls.json'),JSON.stringify({paidRequests:0,allPositiveChecksPass:true,tasks:rows.length,taskControlsSha256:sha(await readFile(join(study,'task-controls.json')))},null,2)+'\n',{flag:'wx'});
