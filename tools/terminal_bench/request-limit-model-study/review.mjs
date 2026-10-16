// Record an explicit source/trace review once. Never infer user acceptance from
// a grader's green endpoint, process exit or official finish alone.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { work, study } from './paths.mjs';
const [name, decisionFile] = process.argv.slice(2);
const rows = JSON.parse(await readFile(join(work, 'f36/analysis.json'))).rows;
const row = rows.find(r => r.name === name);
assert.ok(row, 'Trial not yet scored');
const d = JSON.parse(await readFile(resolve(decisionFile)));
for (const key of ['sourceBehaviorPassed', 'exactFinalSourceChecksPassed', 'fullRequestPassed', 'noSolutionRetrieval']) assert.equal(typeof d[key], 'boolean', key);
assert.ok(d.notes?.length > 100 && Array.isArray(d.criteriaFailures));
assert.equal(d.fullRequestPassed, d.criteriaFailures.length === 0);
const path = join(study, 'source-review.json');
const review = await readFile(path).then(JSON.parse, e => { if (e.code === 'ENOENT') return {
  method: 'Unblinded research-agent inspection of complete source diff, every effective input, actual final-source commands and final factual delivery. Known task; no source repair, solution retrieval, outcome-based trial replacement or independent human adjudication.', decisions: [] }; throw e; });
assert.ok(!review.decisions.some(d => d.name === name), 'Already reviewed; preserve any revision in a separate correction artifact');
review.decisions.push({ name, ...d, reviewedAtUTC: new Date().toISOString(),
  eventsSha256: row.eventsSha256, diffSha256: row.diffSha256, scoreSha256: row.scoreSha256 });
await writeFile(path, JSON.stringify(review, null, 2) + '\n');
console.log(JSON.stringify({ name, ...d }));
