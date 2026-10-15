// Read-only publication of a reviewed immutable completed prefix.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {repo,work,study} from './paths.mjs';
const count=Number(process.argv[2]);assert(Number.isInteger(count)&&count>0&&count<=18);
const revision=process.argv[3]??'';assert(!revision||/^[a-z][a-z-]+$/u.test(revision));
const run=argv=>{const r=spawnSync(argv[0],argv.slice(1),{cwd:repo,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});assert.equal(r.status,0,r.stderr+r.stdout);return r.stdout;};
const node=name=>[process.execPath,'tools/terminal_bench/edit-boundary-study/'+name+'.mjs'];
run([...node('snapshot'),String(count),...(revision?[revision]:[])]);const snapshot=join(work,'checkpoints',String(count)+(revision?'-'+revision:''));
run([process.execPath,'tools/terminal_bench/corpus/light-study-tool-lifecycle.mjs',snapshot]);
run([process.execPath,'tools/terminal_bench/guidance-study/publish.mjs',snapshot,study]);
run([process.execPath,'tools/terminal_bench/navigation-evidence/publish-wire.mjs',snapshot,study]);
run([...node('postprocess'),snapshot,study]);run([...node('summarize'),snapshot]);run([...node('evidence'),snapshot]);run(node('schema-treatment'));run(node('mechanism-exposure'));run(node('failure-classification'));run(node('scope-sensitivity'));run(node('reporting-sensitivity'));run(node('project-sensitivity'));run(node('decision'));run(node('report'));
await writeFile(join(study,'public-replay.json'),run(['python','tools/terminal_bench/edit-boundary-study/verify-public.py',study]));
await writeFile(join(study,'publication-controls.json'),run(['python','tools/terminal_bench/edit-boundary-study/publication-controls.py',study]));
await writeFile(join(study,'prefix-'+count+(revision?'-'+revision:'')+'-summary.json'),await readFile(join(study,'guidance-summary.json')),{flag:'wx'});
console.log(JSON.stringify({published:count,planned:18}));
