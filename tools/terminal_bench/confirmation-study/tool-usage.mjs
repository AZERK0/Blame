// Descriptive tool observations; serialized bytes are not provider tokens.
import {execFileSync} from 'node:child_process';
import {basename,join,resolve} from 'node:path';
import {work as inputWork,study as defaultStudy,json,save,sha} from './setup.mjs';
const work=process.argv[2]?resolve(process.argv[2]):inputWork,study=process.argv[3]?resolve(process.argv[3]):defaultStudy;
const protocol=await json(join(study,'protocol.json'));
const {rows}=await json(join(work,'campaign/analysis.json'));
const inventories=Object.fromEntries(protocol.projects.map(({name:project})=>[project,
  execFileSync('tar',['-tzf',join(inputWork,'upstream',project+'.tar.gz')],{encoding:'utf8'})
    .split('\n').filter(p=>p&&!p.endsWith('/')).map(p=>p.split('/').slice(1).join('/'))]));
const records=[];
for(const row of rows){
  const tools=await json(join(work,'campaign',row.name,'tool-ledger.json'));
  const counts={},readViews={},renderedViews={},editKinds={},searchModes={},referenceEngines={},referenceFallbacks={},missingPaths=[];
  let outputBytes=0,recoveryBytes=0,repeatedReadOutputs=0;const seen=new Set();
  const count=(map,key)=>map[key]=(map[key]??0)+1;
  for(const t of tools){
    count(counts,t.tool);const output=JSON.stringify(t.output)??'';outputBytes+=Buffer.byteLength(output);
    if(t.tool==='read_code'){
      if(typeof t.output?.recovery==='string'&&t.output.recovery.includes('missing_workspace_path'))recoveryBytes+=Buffer.byteLength(t.output.recovery);
      count(readViews,t.input?.view??'omitted');count(renderedViews,t.output?.data?.view??t.output?.status??'unknown');
      if(t.output?.status==='ok'){
        const key=sha(JSON.stringify({input:t.input,output:t.output}));
        if(seen.has(key))repeatedReadOutputs++;seen.add(key);
      }
      if(t.output?.status==='blocked'&&/ENOENT/.test(t.output.message??'')){
        const target=t.input?.target??'',path=target.split('#')[0];
        const candidates=inventories[row.task.split('-')[0]].filter(p=>basename(p)===basename(path));
        missingPaths.push({target,baselineExactBasenameCandidates:candidates});
      }
    }
    if(t.tool==='search_code'){
      count(searchModes,t.input?.mode??'omitted');
      if(t.input?.mode==='references'){count(referenceEngines,t.output?.data?.engine??t.output?.status??'unknown');if(t.output?.data?.semanticFallback)count(referenceFallbacks,t.output.data.semanticFallback);}
    }
    if(t.tool==='edit_code')for(const op of t.input?.operations??[])count(editKinds,op.kind);
  }
  records.push({name:row.name,arm:row.arm,counts,readViews,renderedViews,searchModes,referenceEngines,referenceFallbacks,editKinds,outputBytes,recoveryBytes,repeatedReadOutputs,missingPaths});
}
const arms=Object.fromEntries(protocol.arms.map(arm=>{
  const selected=records.filter(r=>r.arm===arm),combined={};
  for(const field of ['counts','readViews','renderedViews','searchModes','referenceEngines','referenceFallbacks','editKinds']){
    combined[field]={};for(const r of selected)for(const[k,n]of Object.entries(r[field]))combined[field][k]=(combined[field][k]??0)+n;
  }
  return[arm,{trials:selected.length,...combined,outputBytes:selected.reduce((n,r)=>n+r.outputBytes,0),
    recoveryBytes:selected.reduce((n,r)=>n+r.recoveryBytes,0),
    missingReads:selected.reduce((n,r)=>n+r.missingPaths.length,0),
    missingReadsWithBaselineCandidate:selected.reduce((n,r)=>n+r.missingPaths.filter(p=>p.baselineExactBasenameCandidates.length).length,0)}];
}));
await save(join(study,'tool-usage.json'),{complete:rows.length===protocol.order.length,
  method:'Finished tools only. Output bytes and exact repeated input/output pairs are observations, not token or cache savings. Basename candidates come from the original upstream inventory, not a reconstructed workspace at each invocation; they identify opportunities to investigate, not guaranteed safe recovery. Native and Light categories differ.',arms,records});
console.log(JSON.stringify(arms));
