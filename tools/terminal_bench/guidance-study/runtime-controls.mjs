import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {repo,study,work} from './paths.mjs';
const expected={baseline:3,scope:6,references:6,rename:4,reading:6,reporting:9,patch:5,bundle:21};
const rows=[],directory=join(work,'runtime-controls');await mkdir(directory);
for(const [arm,passing]of Object.entries(expected)){
 const tests=['editing','navigation','validation'].map(name=>join(repo,`packages/agent-runtime/dist/harness/light-agent-${name}-guidance.test.js`));
 const result=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{cwd:repo,encoding:'utf8',timeout:90000,maxBuffer:2*1024*1024,env:{...process.env,BLAME_GUIDANCE_RUNTIME:join(work,'frozen/f28',arm,'agent-runtime/dist/harness')}});
 const output=result.stdout+result.stderr;await writeFile(join(directory,arm+'.tap'),output);
 const counts=Object.fromEntries(['tests','pass','fail','skipped'].map(field=>[field,Number(new RegExp(`^# ${field} (\\d+)$`,'mu').exec(output)?.[1])]));
 assert.equal(result.error,undefined);assert.equal(counts.tests,21);assert.equal(counts.pass,passing,arm);assert.equal(counts.skipped,0);assert.equal(counts.fail,21-passing);
 rows.push({arm,counts,exitCode:result.status,sha256:createHash('sha256').update(output).digest('hex'),expectedMissingFeatureFailures:21-passing});
 console.log(JSON.stringify(rows.at(-1)));
}
await writeFile(join(study,'runtime-controls.json'),JSON.stringify({paidRequests:0,method:'Each single-factor build passes exactly its targeted feature controls and the three common negatives; other new-feature assertions intentionally fail. Bundled candidate passes all21. No model inference.',rows},null,2)+'\n');
