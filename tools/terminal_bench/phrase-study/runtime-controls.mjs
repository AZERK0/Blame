import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {repo,work,study} from './paths.mjs';
const rows=[],sha=b=>createHash('sha256').update(b).digest('hex');
const files=['light-agent-navigation-guidance.test','light-agent-editing-guidance.test','light-agent-validation-guidance.test'];
for(const arm of ['baseline','candidate']){
 const argv=[process.execPath,'--test',...files.map(f=>join(repo,'packages/agent-runtime/dist/harness',f+'.js'))];
 const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,BLAME_GUIDANCE_RUNTIME:join(work,'frozen/f29',arm,'agent-runtime/dist/harness')}});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);assert.match(r.stdout,/(?:# |ℹ )tests 21\b/u);
 rows.push({arm,argv,exitCode:r.status,stdout:r.stdout,stderr:r.stderr});
}
await writeFile(join(study,'runtime-controls.json'),JSON.stringify({paidRequests:0,method:'Existing21 all-six guidance contract tests against both isolated runtimes; expected21/21 each,not a model success measure.',rows},null,2)+'\n',{flag:'wx'});
const local=await readFile(join(study,'local-controls.json'));
await writeFile(join(study,'project-controls.json'),JSON.stringify({paidRequests:0,artifact:'local-controls.json',sha256:sha(local),constructedControls:16,realRecordedQueryReplays:8,sourceNotMutatedBySearch:true,discoveryGrantsNoReadCoverage:true},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,arms:rows.length,existingTestsPerArm:21}));
