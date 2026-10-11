import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const rows = [];
const patch = lines => ['*** Begin Patch', '*** Update File: functions.ts', '@@', ...lines, '*** End Patch'].join('\n');
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, 'dist/harness/light-workspace.js')));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, 'dist/harness/session-journal.js')));
  for (const ambiguous of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), 'blame-scoped-recovery-'));
    try {
      const body = ambiguous ? '{\n  void 1;\n  void 1;\n  return 1;\n}' : '{ return 1; }';
      const initial = 'export function amount() ' + body + '\nexport function neighbor() { return 9; }\n';
      await writeFile(join(root, 'functions.ts'), initial);
      const workspace = new LightWorkspace(root, { sessionId: 'scoped-recovery', taskContract: {
        session_id: 'scoped-recovery', objective: 'change amount only', acceptance_criteria: ['neighbor unchanged'], effect_requirement: 'source_change',
      } });
      const found = await workspace.searchCode({ query: 'amount', mode: 'symbol', scope: 'functions.ts' });
      assert.equal(found.status, 'ok');
      const alias = found.data.results[0].alias;
      await workspace.readCode({ target: alias, view: 'symbol' }, {});
      const journal = new SessionJournal(root, 'scoped-recovery');
      const before = await journal.completionSnapshot();
      const refused = await workspace.editCode({ operations: [{ kind: 'patch', target: alias,
        patch: patch(ambiguous ? ['-  void 1;', '+  void 2;'] : ['-export function amount() { return 1; }', '+export function amount() { return 2; }']) }] });
      assert.equal(refused.status, 'blocked');
      assert.match(refused.message, ambiguous ? /context is ambiguous/i : /context does not match/i);
      assert.equal(await readFile(join(root, 'functions.ts'), 'utf8'), initial);
      const after = await journal.completionSnapshot();
      assert.equal(after.sourceRevisionId, before.sourceRevisionId);
      assert.deepEqual(after.changedPaths, []);
      assert.deepEqual(after.validations, []);
      const crossing = await workspace.editCode({ operations: [{ kind: 'patch', target: alias,
        patch: patch(['-function neighbor() { return 9; }', '+function neighbor() { return 99; }']) }] });
      assert.equal(crossing.status, 'blocked');
      assert.equal(await readFile(join(root, 'functions.ts'), 'utf8'), initial);
      const recovered = await workspace.editCode({ operations: [{ kind: 'symbol', target: alias,
        action: 'replace_body', content: '{ return 2; }' }] });
      assert.equal(recovered.status, 'ok');
      assert.equal(recovered.data.changed, true);
      assert.equal(await readFile(join(root, 'functions.ts'), 'utf8'), 'export function amount() { return 2; }\nexport function neighbor() { return 9; }\n');
      rows.push({ runtime, kind: ambiguous ? 'ambiguous-context' : 'export-outside-ast-range',
        refused, recoveryPresent: typeof refused.recovery === 'string' && refused.recovery.length > 0,
        refusalIsNonmutating: true, outOfTargetStillBlocked: true, observedExplicitBodyRecoveryIsExact: true,
        completionNotInvoked: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}
assert.ok(rows.length, 'Pass built runtime directories.');
console.log(JSON.stringify({ classification: 'Direct executor diagnostic; recovery field availability and guarded repair are not model recovery or completed user task success.', rows }, null, 2));
