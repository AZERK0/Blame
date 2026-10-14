import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {repo,study,work} from './paths.mjs';
import {applyOracle} from '../navigation-evidence/multifile-criteria.mjs';
const protocol=JSON.parse(await readFile(join(study,'protocol.json'))),root=join(work,'project-controls');await mkdir(root);
const rows=[];
for(const task of protocol.tasks.filter(t=>t.kind==='multifile-rename'))for(const arm of ['baseline','bundle']){
 const workspace=join(root,task.id+'-'+arm);
 execFileSync(process.execPath,[join(repo,'tools/terminal_bench/guidance-study/run.mjs'),'prepare','f28',workspace,task.id],{cwd:repo});
 const {LightWorkspace}=await import(pathToFileURL(join(work,'frozen/f28',arm,'agent-runtime/dist/harness/light-workspace.js')));
 const runtime=new LightWorkspace(workspace,{sessionId:'private-project-control'});
 const target=task.declarationPath+'#'+task.oldName;
 const refs=await runtime.searchCode({query:target,mode:'references'});
 await runtime.readCode({target},{});
 const original=Object.fromEntries(await Promise.all(task.allowedPaths.map(async path=>[path,await readFile(join(workspace,path),'utf8')])));
 const rename=await runtime.editCode({operations:[{kind:'symbol',target,action:'rename',content:task.newName}]});
 const endpointMatches=rename.status==='ok'&&(await Promise.all(task.allowedPaths.map(async path=>await readFile(join(workspace,path),'utf8')===applyOracle(original[path],task.oracle.spans[path]??[],task.newName)))).every(Boolean);
 rows.push({id:task.id,arm,refs,rename,endpointMatches});
 await writeFile(join(study,'project-controls.json'),JSON.stringify({paidRequests:0,rows},null,2)+'\n');
 assert.equal(rename.status,'ok',JSON.stringify(rows.at(-1)));assert(endpointMatches);
}
console.log(JSON.stringify({paidRequests:0,controls:rows.length,allEndpointsMatch:true}));
