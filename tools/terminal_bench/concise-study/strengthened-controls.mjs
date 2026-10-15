// Known diagnostics only: never count previous endpoints as fresh confirmations.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';
import {repo,work,study} from './paths.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const parent='docs/experiments/light-harness-phrase-ranking-f29-2026-10-15';
const before=await readFile(join(repo,parent,'results.json'));
const output=join(work,'known-iteratee-replay.json');
const r=spawnSync(process.execPath,[join(repo,'tools/terminal_bench/phrase-study/iteratee-default-diagnostic.mjs'),join(repo,'.blame/research/confirmation-f29/f29'),output],{cwd:repo,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
const bytes=await readFile(output),d=JSON.parse(bytes),expected=['2-lodash-iterator-own-mode-candidate','2-lodash-iterator-own-mode-cline','3-lodash-iterator-own-mode-candidate'];
assert.equal(d.rows.length,9);assert(d.rows.every(r=>r.assessedCases===56&&r.sourceUnchanged&&r.frozenIndependentFunctionalSuccess));
assert.deepEqual(d.rows.filter(r=>r.differences.length).map(r=>r.name).sort(),expected);
assert.deepEqual(await readFile(join(repo,parent,'results.json')),before);
const artifact='known-iteratee-replay.json.gz';await writeFile(join(study,artifact),gzipSync(bytes,{mtime:0}),{flag:'wx'});
await writeFile(join(study,'strengthened-evaluation-controls.json'),JSON.stringify({paidRequests:0,knownDiagnosticOnly:true,
 method:'Original frozen grades remain unchanged. The same default/opt-in hook and exception probes deterministically expose three passing-test false positives across all nine old iterator endpoints. New F30 features and mutation controls are selected before model outcomes.',
 originalResultsSha256:sha(before),originalGradesUnchanged:true,endpoints:9,correlatedCasesPerEndpoint:56,expectedRejectedEndpoints:expected,
 artifact,uncompressedSha256:sha(bytes),scriptSha256:sha(await readFile(join(repo,'tools/terminal_bench/phrase-study/iteratee-default-diagnostic.mjs')))},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({paidRequests:0,knownEndpoints:9,expectedCounterexamples:3,originalGradesUnchanged:true}));
