// Post-hoc source audit, uniformly applied to every completed stable-sum trial.
// The selected official checks and agent endpoints remain unchanged.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdir,writeFile,rm,symlink,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {work,study,json,save,sha} from './setup.mjs';
const startedAtUTC=new Date().toISOString();
const root=join(work,'numeric-witness');await mkdir(root,{recursive:true});
const witness=`import * as r from './packages/remeda/src/index.ts';
const m=Number.MAX_VALUE;
const cases={positiveOverflow:[m,m],negativeOverflow:[-m,-m],overflowThenOppositeInfinity:[m,m,-Infinity],negativeOverflowThenOppositeInfinity:[-m,-m,Infinity]};
const value=x=>Number.isNaN(x)?'NaN':x===Infinity?'+Infinity':x===-Infinity?'-Infinity':Object.is(x,-0)?'-0':x;
console.log(JSON.stringify(Object.fromEntries(Object.entries(cases).map(([name,xs])=>[name,{sum:value(r.sum(xs)),sumBy:value(r.sumBy(xs,x=>x)),mean:value(r.mean(xs)),meanBy:value(r.meanBy(xs,x=>x))}]))));
`;
const analysis=await json(join(work,'campaign/analysis.json'));
const selected=analysis.rows.filter(r=>r.task==='remeda-stable-sum');
const records=[];
for(const row of [null,{name:"positive-control",control:true},...selected]){
  const model=row&&!row.control;
  const name=row?.name??'original',folder=join(root,name);await mkdir(folder,{recursive:true});
  const archive=model?join(work,'campaign',name,'workspace.tar.gz'):join(work,'upstream/remeda.tar.gz');
  const prefix=model?'workspace':'remeda-729ead3f458a24167154e5ba6e9305022baabfcf';
  execFileSync('tar',['-xzf',archive,'--strip-components=1','-C',folder,prefix+'/packages/remeda/src']);
  if(row?.control){execFileSync('git',['init','--quiet'],{cwd:folder});execFileSync('git',['apply',join(study,'positive-remeda-stable-sum.patch')],{cwd:folder});}
  await symlink(join(work,'dependencies/node_modules'),join(folder,'node_modules'));
  await writeFile(join(folder,'package.json'),'{"type":"module"}\n');await writeFile(join(folder,'witness.mjs'),witness);
  if(model){const grade=await json(join(work,'campaign',name,'score.json'));for(const[path,hash]of Object.entries(grade.sourceHashes))if(path.startsWith('packages/remeda/src/'))assert.equal(sha(await readFile(join(folder,path))),hash);}
  const out=spawnSync(process.execPath,['--import','tsx','witness.mjs'],{cwd:folder,encoding:'utf8',timeout:30000});
  records.push({name,hashes:row?.hashes??null,exitCode:out.status,stdout:out.stdout,stderr:out.stderr,observations:out.status===0?JSON.parse(out.stdout):null});
  await rm(folder,{recursive:true,force:true});
}
assert.equal(records[0].exitCode,0);
for(const record of records)record.matchesOriginal=record.exitCode===0&&JSON.stringify(record.observations)===JSON.stringify(records[0].observations);
await save(join(study,'numeric-overflow-witness.json'),{startedAtUTC,endedAtUTC:new Date().toISOString(),
  classification:'Post-hoc source-audit witness prompted by trial 12; not a selected official benchmark check. Applied to all completed stable-sum endpoints without repair. Later repeats remain separate from the motivating known diagnosis.',
  method:'Extract unchanged production source from original upstream / exact private endpoint archives; execute the same four public APIs with pinned tsx. The explicit task requires preserving IEEE NaN/infinity behavior. Compare intermediate finite-input overflow and subsequent opposite infinity with the original API.',
  source:witness,sourceSha256:sha(witness),completedStableSumTrials:selected.length,records});
console.log(JSON.stringify(records.map(r=>({name:r.name,matchesOriginal:r.matchesOriginal,observations:r.observations}))));
