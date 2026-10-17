// Descriptive tool observations; serialized bytes are not provider tokens.
import {execFileSync} from 'node:child_process';
import {basename,join} from 'node:path';
import {work,study,json,save,sha} from './setup.mjs';
const {rows}=await json(join(work,'campaign/analysis.json'));
const inventories=Object.fromEntries(['valibot','remeda'].map(project=>[project,
  execFileSync('tar',['-tzf',join(work,'upstream',project+'.tar.gz')],{encoding:'utf8'})
    .split('\n').filter(p=>p&&!p.endsWith('/')).map(p=>p.split('/').slice(1).join('/'))]));
const records=[];
for(const row of rows){
  const tools=await json(join(work,'campaign',row.name,'tool-ledger.json'));
  const counts={},readViews={},renderedViews={},editKinds={},searchModes={},missingPaths=[];
  let outputBytes=0,repeatedReadOutputs=0;const seen=new Set();
  const count=(map,key)=>map[key]=(map[key]??0)+1;
  for(const t of tools){
    count(counts,t.tool);const output=JSON.stringify(t.output)??'';outputBytes+=Buffer.byteLength(output);
    if(t.tool==='read_code'){
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
    if(t.tool==='search_code')count(searchModes,t.input?.mode??'omitted');
    if(t.tool==='edit_code')for(const op of t.input?.operations??[])count(editKinds,op.kind);
  }
  records.push({name:row.name,arm:row.arm,counts,readViews,renderedViews,searchModes,editKinds,outputBytes,repeatedReadOutputs,missingPaths});
}
const arms=Object.fromEntries(['reference','compiler','cline'].map(arm=>{
  const selected=records.filter(r=>r.arm===arm),combined={};
  for(const field of ['counts','readViews','renderedViews','searchModes','editKinds']){
    combined[field]={};for(const r of selected)for(const[k,n]of Object.entries(r[field]))combined[field][k]=(combined[field][k]??0)+n;
  }
  return[arm,{trials:selected.length,...combined,outputBytes:selected.reduce((n,r)=>n+r.outputBytes,0),
    missingReads:selected.reduce((n,r)=>n+r.missingPaths.length,0),
    missingReadsWithBaselineCandidate:selected.reduce((n,r)=>n+r.missingPaths.filter(p=>p.baselineExactBasenameCandidates.length).length,0)}];
}));
await save(join(study,'tool-usage.json'),{complete:rows.length===54,
  method:'Finished tools only. Output bytes and exact repeated input/output pairs are observations, not token or cache savings. Basename candidates come from the original upstream inventory, not a reconstructed workspace at each invocation; they identify opportunities to investigate, not guaranteed safe recovery. Native and Light categories differ.',arms,records});
console.log(JSON.stringify(arms));
