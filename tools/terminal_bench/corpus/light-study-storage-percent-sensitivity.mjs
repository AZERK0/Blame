// Add one post-hoc diagnostic to every fixed convention, without replacing primary results.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const directory = resolve(process.argv[2]);
const bytes = await readFile(join(directory, 'results.json'));
const original = JSON.parse(bytes);
const decisions = JSON.parse(await readFile(join(directory, 'adjudication.json'))).decisions;
const inventory = JSON.parse(await readFile(join(directory, 'inventory.json')));
const percentBytes = await readFile(join(directory, 'storage-percent-replay.json'));
const percent = JSON.parse(percentBytes);
const slug = JSON.parse(await readFile(join(directory, 'slug-replay.json')));
const comparisons = [];
for (const extendedMarks of [false, true]) for (const expandedDates of [true, false])
  for (const physicalAbsence of [true, false]) {
    const results = structuredClone(original);
    const counts = {};
    for (const row of results.rows) {
      const decision = decisions.find(d => d.name === row.name);
      let criteria = decision.independentSuccess;
      if (!expandedDates && row.id === 'stable-pagination') criteria = decision.normalizedTimestampSensitivitySuccess;
      if (!physicalAbsence && row.id === 'stale-save-reducer') criteria = decision.valueSemanticsSensitivitySuccess;
      if (extendedMarks && row.id === 'slug-contract') {
        const check = slug.rows.find(r => r.name === row.name);
        assert.equal(typeof check?.passed, 'boolean');
        criteria &&= check.passed;
      }
      if (row.id === 'storage-traversal') {
        const check = percent.rows.find(r => r.name === row.name);
        assert.equal(typeof check?.passed, 'boolean');
        const instruction = inventory.find(item => item.artifact === `${row.name}.instruction.txt.gz`);
        assert.ok(instruction, 'Published instruction binding missing');
        assert.equal(check.instructionSha256, instruction.sha256);
        assert.equal(check.diffSha256, row.diffSha256);
        criteria &&= check.passed;
      }
      assert.equal(typeof criteria, 'boolean');
      counts[row.arm] ??= { trials: 0, auditedCriteria: 0, auditedCompletion: 0 };
      const count = counts[row.arm];
      count.trials++;
      count.auditedCriteria += Number(criteria);
      count.auditedCompletion += Number(criteria && row.status === 'succeeded');
      row.auditedSuccess = criteria && row.status === 'succeeded';
      row.auditedCompletion = row.auditedSuccess;
    }
    const temporary = await mkdtemp(join(tmpdir(), 'blame-percent-comparison-'));
    try {
      await writeFile(join(temporary, 'results.json'), JSON.stringify(results));
      execFileSync(process.execPath, [fileURLToPath(new URL('./light-study-compare.mjs', import.meta.url)), temporary], { stdio: 'ignore' });
      const paired = JSON.parse(await readFile(join(temporary, 'paired-comparison.json')));
      comparisons.push({ extendedMarks, timestampConvention: expandedDates ? 'valid ISO offsets/equal instants' : 'canonical normalized timestamps',
        optionalFields: physicalAbsence ? 'physical absence' : 'undefined value allowed', counts, paired: paired.comparisons });
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
const result = {
  selection: 'Post-hoc valid-percent diagnostic, applied uniformly to all registered timestamp/optional-field conventions, separately and together with registered extended-mark diagnostics. Original primary endpoints stay unchanged. Resource cohorts require completed success and reconciled usage; no favorable convention selected.',
  originalResultsSha256: createHash('sha256').update(bytes).digest('hex'),
  percentReplaySha256: createHash('sha256').update(percentBytes).digest('hex'), comparisons,
};
await writeFile(join(directory, 'exploratory-storage-percent-sensitivity.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(comparisons.map(({ extendedMarks, timestampConvention, optionalFields, counts }) => ({ extendedMarks, timestampConvention, optionalFields, counts }))));
