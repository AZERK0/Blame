import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { evaluateCapContract } from './cap-contract.mjs';
const checks = [
  ['reference remains uncapped', 'baseline', [{ maximumOutputTokens: null }], [{ output: 128000 }], true],
  ['exact ceiling is admitted', 'candidate', [{ maximumOutputTokens: 8192 }], [{ output: 8192 }], true],
  ['missing treatment cap is refused', 'candidate', [{ maximumOutputTokens: null }], [{ output: 5 }], false],
  ['reported overshoot is refused', 'cline-cap', [{ maximumOutputTokens: 8192 }], [{ output: 8193 }], false],
  ['unexpected reference cap is refused', 'cline', [{ maximumOutputTokens: 8192 }], [{ output: 5 }], false],
  ['usage without request capture is refused', 'candidate', [], [{ output: 5 }], false],
  ['a rejected dispatch is not cap exposure', 'candidate', [{ budgetRejected: true, maximumOutputTokens: null }], [], true],
  ['no inference after access failure stays unexposed', 'candidate', [], [], true],
  ['unknown output stays explicitly unknown', 'candidate', [{ maximumOutputTokens: 8192 }], [{ output: null }], true],
  ['missing response stays explicitly unreported', 'candidate', [{ maximumOutputTokens: 8192 }], [], true],
];
const rows = checks.map(([name, arm, requests, reports, expected]) => {
  const result = evaluateCapContract(arm, requests, reports, 8192);
  assert.equal(result.passed, expected, name);
  if (name.startsWith('unknown')) { assert.equal(result.unknownOutputReports, 1); assert.equal(result.allForwardedOutputsObserved, false); }
  if (name.startsWith('missing response')) { assert.equal(result.unreportedAttempts, 1); assert.equal(result.allForwardedOutputsObserved, false); }
  return { name, expected, result };
});
const output = { paidRequests: 0, cases: rows.length, rows };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ paidRequests: 0, passed: rows.length }));
