// Additional descriptive statistic; the completion endpoint itself is registered.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
const directory = resolve(process.argv[2]);
const raw = await readFile(join(directory, 'results.json'));
const results = JSON.parse(raw);
assert.equal(results.completed, results.planned);
const comparisons = [];
for (const [left, right] of [['modified', 'baseline'], ['modified', 'cline'], ['baseline', 'cline']]) {
  for (const partition of ['all', 'diagnostic', 'confirmation']) {
    const pairs = results.rows.filter(row => row.arm === left &&
      (partition === 'all' || row.partition === partition)).map(row => [row,
        results.rows.find(other => other.arm === right && other.id === row.id &&
          other.repetition === row.repetition && other.condition === row.condition)]);
    assert.ok(pairs.every(([, row]) => row));
    const clusters = new Map();
    for (const [a, b] of pairs) {
      const cluster = clusters.get(a.id) ?? [0, 0, 0];
      cluster[0] += Number(a.auditedSuccess && a.status === 'succeeded');
      cluster[1] += Number(b.auditedSuccess && b.status === 'succeeded');
      cluster[2]++;
      clusters.set(a.id, cluster);
    }
    const values = [...clusters.values()];
    const totals = values.reduce((sum, value) => sum.map((n, i) => n + value[i]), [0, 0, 0]);
    let state = 20261009;
    const draws = [];
    if (values.length) for (let draw = 0; draw < 10000; draw++) {
      let difference = 0, count = 0;
      for (let i = 0; i < values.length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const [a, b, n] = values[Math.floor(state / 4294967296 * values.length)];
        difference += a - b; count += n;
      }
      draws.push(difference / count);
    }
    draws.sort((a, b) => a - b);
    comparisons.push({ left, right, partition, pairs: pairs.length, taskClusters: values.length,
      leftAuditedCompletion: totals[0], rightAuditedCompletion: totals[1],
      rateDifference: totals[2] ? (totals[0] - totals[1]) / totals[2] : null,
      interval95: draws.length ? [draws[250], draws[9750]] : null });
  }
}
const result = {
  method: 'Additional exploratory descriptive uncertainty, not separately preregistered: all planned pairs, audited criteria AND successful runtime completion, 10000 task-cluster percentile draws with seed 20261009, no model resampling. Internal selected tasks are not a random population sample. An all-success sample has degenerate [0,0] descriptive differences, not certainty about future failure. This does not establish statistical noninferiority, equivalence or provider causality.',
  originalResultsSha256: createHash('sha256').update(raw).digest('hex'), comparisons,
};
await writeFile(join(directory, 'quality-uncertainty.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(comparisons));
