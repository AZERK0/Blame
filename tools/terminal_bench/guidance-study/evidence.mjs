// Read-only integrity checks. Finite recorded evidence, not outcome adjudication.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,readdir,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {gzipSync,gunzipSync} from 'node:zlib';
import {repo,work,study} from './paths.mjs';
import {repairSearchSource} from '../navigation-evidence/native-search-repair.mjs';
const campaign=process.argv[2]??join(work,'f28'),json=async p=>JSON.parse(await readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const protocol=await json(join(study,'protocol.json')),results=await json(join(study,'results.json'));
const bindings=await json(join(study,'execution-bindings.json'));
assert.equal(results.planned,protocol.tasks.length*protocol.repetitions*protocol.arms.length);
assert.deepEqual(results.provenance.frozen,bindings);
assert.deepEqual(results.rows.map(({repetition,id,arm})=>({repetition,id,arm})),protocol.order.slice(0,results.completed));
assert.equal(sha(await readFile(join(study,'protocol.json'))),results.provenance.protocolSha256);
for(const [path,expected] of Object.entries(bindings.inputs))assert.equal(sha(await readFile(join(repo,path))),expected,path);
async function tree(root){
 const hash=createHash('sha256');
 for(const path of (await readdir(root,{recursive:true,withFileTypes:true})).filter(e=>e.isFile()).map(e=>join(e.parentPath??e.path,e.name)).sort()){
  hash.update('/'+path.slice(root.length+1)+'\0');hash.update(await readFile(path));
 }return hash.digest('hex');
}
for(const arm of protocol.lightArms){
 const frozen=join(work,'frozen/f28',arm);
 assert.equal(await tree(join(frozen,'agent-runtime/dist')),bindings.versions[arm].runtime,arm);
 assert.equal(await tree(join(frozen,'benchmark-runner/dist')),bindings.versions[arm].runner,arm);
}
const wire=JSON.parse(gunzipSync(await readFile(join(study,'wire-contracts.json.gz'))));
const dateBinding=await json(join(study,'prompt-date-binding.json'));
const nativeBinding=await json(join(study,'native-search-bindings.json'));
const sdk=await realpath(join(repo,'packages/agent-runtime/node_modules/@cline/sdk/package.json'));
const heads={},audits=[],firstContracts=[];
for(const row of results.rows){
 const directory=join(campaign,row.name),workspace=join(directory,'workspace');
 const git=argv=>execFileSync('git',argv,{cwd:workspace,encoding:'utf8'}).trim();
 const initial=git(['rev-list','--max-parents=0','HEAD']);
 heads[row.name]={head:initial,tree:git(['rev-parse',initial+'^{tree}'])};
 assert.equal(Date.parse(git(['show','-s','--format=%cI',initial])),Date.parse(protocol.taskInputCommitAtUTC));
 const start=await json(join(directory,'model-start.json'));
 assert.equal(start.gitHead,initial);
 const requests=wire.trials.find(t=>t.name===row.name).requests;
 for(const request of requests){
  assert.equal(request.model,protocol.model);assert.equal(request.reasoning.effort,protocol.effort);
  assert.equal(request.maximumOutputTokens,null);assert.equal(request.byteLimit,protocol.budgets.maximumSerializedRequestBytes);
  assert.equal(request.toolCount,row.arm==='cline'?5:7);
  assert.equal(request.budgetRejected,request.requestBytes>request.byteLimit);
 }
 const first=requests.find(r=>!r.budgetRejected);
 firstContracts.push({name:row.name,toolsSha256:first?.toolsSha256??null,promptSha256:first?.promptSha256??null,normalizedContractSha256:first?.normalizedContractSha256??null});
 for(const file of ['prompt-date-loads.jsonl',...(row.arm==='cline'?['native-search-loads.jsonl']:[])]){
  const bytes=await readFile(join(directory,file)),records=bytes.toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  assert(records.length>0);
  for(const record of records){
   if(file==='prompt-date-loads.jsonl'){
    assert(dateBinding.originalHashes.includes(record.originalSha256));assert.equal(record.fixedDate,dateBinding.fixedDate);
    const arm=row.arm==='cline'?protocol.clineRuntimeArm:row.arm;
    const source=await readFile(join(work,'frozen/f28',arm,'agent-runtime/dist/cline-runtime-prompts.js'),'utf8');
    assert.equal(sha(source),record.originalSha256);
    assert.equal(sha(source.replace('CURRENT_DATE: new Date().toISOString().slice(0, 10)','CURRENT_DATE: '+JSON.stringify(dateBinding.fixedDate))),record.patchedSha256);
   }else{
    assert.equal(record.originalSha256,nativeBinding.modules[record.module]);
    const source=await readFile(join(dirname(sdk),'../core/dist',record.module),'utf8');
    assert.equal(sha(source),record.originalSha256);assert.equal(sha(repairSearchSource(source).source),record.repairedSha256);
   }
  }
  const artifact='execution-audits/'+row.name+'.'+file+'.gz';
  await mkdir(join(study,'execution-audits'),{recursive:true});await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}));
  audits.push({name:row.name,file,artifact,sha256:sha(bytes),bytes:bytes.length,records});
 }
 if(row.arm!=='cline'){
  await assert.rejects(readFile(join(directory,'native-search-loads.jsonl')),error=>error.code==='ENOENT');
 }
}
const matchedInitialIdentities=[];
for(const task of protocol.tasks)for(let repetition=1;repetition<=protocol.repetitions;repetition++){
 const rows=results.rows.filter(r=>r.id===task.id&&r.repetition===repetition);
 if(!rows.length)continue;
 for(const row of rows)assert.deepEqual(heads[row.name],heads[rows[0].name]);
 matchedInitialIdentities.push({id:task.id,repetition,arms:rows.map(r=>r.arm),sameHeadAndTree:true});
}
const output={paidRequests:0,planned:results.planned,completed:results.completed,frozenInputsAndRuntimesVerified:true,
 actualWireModelEffortByteGuardVerified:true,nominalOutputCapEffective:false,commonDateProjectionVerified:true,
 nativeRepairLoadsVerified:true,initialIdentities:heads,matchedInitialIdentities,firstContracts,audits,
 method:'Integrity does not require favorable outcomes. Source hashes, runtime trees, actual wire settings, common date and native search projections and initial task Git identities verified. Factor-specific schemas and prompts intentionally differ. No source repair, model retry, new model call or independent re-adjudication of manual review.'};
await writeFile(join(study,'evidence-checks.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({completed:results.completed,planned:results.planned,paidRequests:0,audits:audits.length,matchedInitialIdentities:matchedInitialIdentities.length}));
