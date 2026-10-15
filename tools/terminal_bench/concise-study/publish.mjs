// Publish a completed,explicitly reviewed prefix. Never dispatches a model.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {repo,work,study} from './paths.mjs';
const count=Number(process.argv[2]);assert(Number.isInteger(count)&&count>0&&count<=27);
function run(argv){const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});if(r.status!==0)throw Error(argv.join(' ')+'\n'+r.stdout+'\n'+r.stderr);return r.stdout;}
const snapshot=join(work,'checkpoints',String(count));
run([process.execPath,'tools/terminal_bench/concise-study/snapshot.mjs',String(count)]);
run([process.execPath,'tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs',snapshot]);
run([process.execPath,'tools/terminal_bench/guidance-study/publish.mjs',snapshot,study]);
run([process.execPath,'tools/terminal_bench/navigation-evidence/publish-wire.mjs',snapshot,study]);
run([process.execPath,'tools/terminal_bench/concise-study/postprocess.mjs',snapshot,study]);
run([process.execPath,'tools/terminal_bench/concise-study/summarize.mjs',snapshot]);
run([process.execPath,'tools/terminal_bench/concise-study/evidence.mjs',snapshot]);
run([process.execPath,'tools/terminal_bench/concise-study/report.mjs']);
const replay=run(['python','tools/terminal_bench/concise-study/verify-public.py',study]);
await writeFile(join(study,'public-replay.json'),replay);
const controls=run(['python','tools/terminal_bench/concise-study/publication-controls.py',study]);
await writeFile(join(study,'publication-controls.json'),controls);
// Preserve the selected-prefix interpretation separately from future publication.
const s=JSON.parse(await readFile(join(study,'guidance-summary.json')));
await writeFile(join(study,'prefix-'+count+'-summary.json'),JSON.stringify(s,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({completed:s.completed,planned:s.planned,totalAccountedUsd:s.totalAccountedUsd,referenceEquivalentEur:s.referenceEquivalentEur,validPublicReplay:true}));
