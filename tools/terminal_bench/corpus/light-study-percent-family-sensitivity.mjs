// Supplemental validity-family overlay; never replace the registered T3 endpoint.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const directory = resolve(process.argv[2]);
const bytes = await readFile(join(directory, 'results.json'));
const original = JSON.parse(bytes);
const decisions = JSON.parse(await readFile(join(directory, 'adjudication.json'))).decisions;
const inventory = JSON.parse(await readFile(join(directory, 'inventory.json')));
const replayBytes = await readFile(join(directory, 'storage-percent-family-replay.json'));
const replay = JSON.parse(replayBytes);
const comparisons = [];
for (const expandedDates of [true, false]) for (const physicalAbsence of [true, false]) {
  const results = structuredClone(original), counts = {};
  for (const row of results.rows) {
    const decision = decisions.find(d => d.name === row.name);
    let criteria = decision.independentSuccess;
    if (!expandedDates && row.id === 'stable-pagination') criteria = decision.normalizedTimestampSensitivitySuccess;
    if (!physicalAbsence && row.id === 'stale-save-reducer') criteria = decision.valueSemanticsSensitivitySuccess;
    if (row.id === 'storage-traversal') {
      const check = replay.rows.find(r => r.name === row.name);
      assert.equal(typeof check?.passed, 'boolean');
      assert.equal(check.diffSha256, row.diffSha256);
      assert.equal(check.instructionSha256, inventory.find(i => i.artifact === `${row.name}.instruction.txt.gz`)?.sha256);
      criteria &&= check.passed;
    }
    assert.equal(typeof criteria, 'boolean');
    counts[row.arm] ??= { trials: 0, auditedCriteria: 0, auditedCompletion: 0 };
    counts[row.arm].trials++;
    counts[row.arm].auditedCriteria += Number(criteria);
    counts[row.arm].auditedCompletion += Number(criteria && row.status === 'succeeded');
    row.auditedSuccess = criteria && row.status === 'succeeded';
  }
  const temporary = await mkdtemp(join(tmpdir(), 'blame-percent-family-'));
  try {
    await writeFile(join(temporary, 'results.json'), JSON.stringify(results));
    execFileSync(process.execPath, [fileURLToPath(new URL('./light-study-compare.mjs', import.meta.url)), temporary], { stdio: 'ignore' });
    const paired = JSON.parse(await readFile(join(temporary, 'paired-comparison.json')));
    comparisons.push({ timestampConvention: expandedDates ? 'valid ISO offsets/equal instants' : 'canonical normalized timestamps',
      optionalFields: physicalAbsence ? 'physical absence' : 'undefined value allowed', counts, paired: paired.comparisons });
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
await writeFile(join(directory, 'exploratory-percent-family-sensitivity.json'), JSON.stringify({
  selection: 'Post-hoc family expansion discovered during T3 canary native-source inspection. Fixed case list applied uniformly within each separate panel and every registered date/optional-field convention. Primary results, official scores and earlier campaigns remain unchanged. Matched resources require completed success and reconciled usage; no source repair or agent feedback.',
  originalResultsSha256: createHash('sha256').update(bytes).digest('hex'),
  replaySha256: createHash('sha256').update(replayBytes).digest('hex'), comparisons,
}, null, 2) + '\n');
console.log(JSON.stringify(comparisons.map(({ counts }) => counts)));
