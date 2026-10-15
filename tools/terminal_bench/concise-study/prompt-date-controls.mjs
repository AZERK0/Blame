import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const protocol=JSON.parse(await readFile(join(study,'protocol.json')));
const originalHashes=[...new Set(await Promise.all(protocol.lightArms.map(async arm=>createHash('sha256').update(await readFile(join(work,'frozen/f30',arm,'agent-runtime/dist/cline-runtime-prompts.js'))).digest('hex'))))];
const binding={fixedDate:'2026-10-15',originalHashes,scope:'Common load-time prompt date only; clocks/OAuth/commands stay real.'};
await writeFile(join(study,'prompt-date-binding.json'),JSON.stringify(binding,null,2)+'\n',{flag:'wx'});
const root=await mkdtemp(join(tmpdir(),'guidance-date-'));const rows=[];
try {
 await writeFile(join(root,'package.json'),'{}');
 for(const arm of ['baseline','candidate']){
  const script=`const {buildDevelopmentSystemPrompt}=await import(${JSON.stringify(join(work,'frozen/f30',arm,'agent-runtime/dist/cline-runtime-prompts.js'))});const text=await buildDevelopmentSystemPrompt({cwd:${JSON.stringify(root)},workspaceRoot:${JSON.stringify(root)}});if(!text.includes('date: 2026-10-15'))throw Error('Date not frozen');console.log(JSON.stringify({dateFrozen:true,realClock:Date.now()>1700000000000,promptBytes:Buffer.byteLength(text)}));`;
  const result=spawnSync(process.execPath,['--import',join(repo,'tools/terminal_bench/concise-study/prompt-date.mjs'),'--input-type=module','-e',script],{cwd:repo,encoding:'utf8',env:{...process.env,BLAME_STUDY_DATE_BINDING:join(study,'prompt-date-binding.json')}});
  assert.equal(result.status,0,result.stderr);rows.push({arm,...JSON.parse(result.stdout)});
 }
}finally{await rm(root,{recursive:true,force:true});}
await writeFile(join(study,'prompt-date-controls.json'),JSON.stringify({paidRequests:0,binding,rows},null,2)+'\n');
console.log(JSON.stringify({paidRequests:0,rows}));
