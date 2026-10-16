// Read original public tool ledgers, keeping task acceptance and admission separate.
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repo, json, save, sha } from './setup.mjs';
const study = join(repo, 'docs/experiments/light-harness-compiler-check-model-f41-2026-10-16');
const results = await json(join(study, 'results.json')), records = [];
for (const row of results.rows) {
  const bytes = await readFile(join(study, 'traces', row.name + '.json.gz')); assert.equal(sha(bytes), row.traceSha256);
  const archive = JSON.parse(gunzipSync(bytes));
  const tools = JSON.parse(Buffer.from(archive.files['tool-ledger.json'].base64, 'base64'));
  const typeInvocations = tools.filter(tool => tool.tool === 'run_task' &&
    /(?:test:study:types|typescript\/bin\/tsc)/u.test(tool.output?.data?.command ?? '')).map(tool => ({
      command: tool.output.data.command, exitCode: tool.output.data.exitCode ?? null,
      check: tool.output.data.check ?? null, validation: tool.output.data.validation ?? null }));
  if (row.arm === 'compiler') {
    assert.ok(typeInvocations.length > 0);
    for (const invocation of typeInvocations) {
      assert.equal(invocation.validation.taskKind, 'typecheck'); assert.equal(invocation.validation.scope, 'invocation_only');
      assert.deepEqual(invocation.validation.paths, []); assert.equal(invocation.exitCode, 0); assert.equal(invocation.check, null);
    }
    assert.ok(row.completion.satisfied_obligations.includes('check:types')); assert.equal(row.completion.verification, 'unverified');
  }
  records.push({ name: row.name, arm: row.arm, auditedTaskSuccess: row.auditedCompletion,
    compilerObligationSatisfied: row.arm === 'cline' ? null : row.completion.satisfied_obligations.includes('check:types'),
    sourceVerification: row.completion?.verification ?? null, typeInvocations,
    blockedEdits: row.blockedEdits, executionOnlyFailures: tools.filter(tool => tool.tool === 'run_commands' && Array.isArray(tool.output)).flatMap(tool => tool.output.filter(out => out.success === false)) });
}
await save(join(study, 'mechanism.json'), { modelRequests: 0, records,
  interpretation: 'All assigned attempts retained. Exact required compiler admission improves, source verification remains unverified. Post-hoc paired resource sensitivity is in summary.json: token gains reverse if reference repeat2 (multiple edit retries and reruns) is excluded. No causal mediation of resource savings is established; this known task is not fresh confirmation.' });
console.log(JSON.stringify({ records: records.length, compilerInvocationOnly: records.filter(row => row.arm === 'compiler').length }));
