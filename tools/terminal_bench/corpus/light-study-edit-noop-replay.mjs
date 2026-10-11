// Direct replay of indentation normalization; this does not exercise the SDK loop guard.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const rows = [];
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, 'dist/harness/light-workspace.js')));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, 'dist/harness/session-journal.js')));
  const root = await mkdtemp(join(tmpdir(), 'blame-edit-noop-'));
  try {
    const initial = 'export function response() {\n  return {\n      id: "p",\n    };\n}\n';
    await writeFile(join(root, 'response.ts'), initial);
    const workspace = new LightWorkspace(root, { sessionId: 'noop-replay', taskContract: {
      session_id: 'noop-replay', objective: 'fix body indentation', acceptance_criteria: ['two-space indentation'], effect_requirement: 'source_change',
    } });
    await workspace.readCode({ target: 'response.ts#response', view: 'symbol' }, {});
    const journal = new SessionJournal(root, 'noop-replay');
    const before = await journal.completionSnapshot();
    const result = await workspace.editCode({ operations: [{ kind: 'symbol', target: 'response.ts#response',
      action: 'replace_body', content: 'return {\n    id: "p",\n  };' }] });
    assert.equal(result.status, 'ok');
    assert.equal(result.data.changed, false);
    assert.equal(result.receipt, undefined);
    assert.equal(await readFile(join(root, 'response.ts'), 'utf8'), initial);
    const after = await journal.completionSnapshot();
    assert.equal(after.sourceRevisionId, before.sourceRevisionId);
    assert.deepEqual(after.changedPaths, []);
    assert.deepEqual(after.validations, []);
    const corrected = await workspace.editCode({ operations: [{ kind: 'symbol', target: 'response.ts#response',
      action: 'replace_body', content: '{\n  return {\n    id: "p",\n  };\n}' }] });
    assert.equal(corrected.status, 'ok');
    assert.equal(corrected.data.changed, true);
    assert.equal(await readFile(join(root, 'response.ts'), 'utf8'), 'export function response() {\n  return {\n    id: "p",\n  };\n}\n');
    rows.push({ runtime, noop: result, unchangedSourceAndRevision: true, noChangeReceiptOrValidation: true,
      bracedBodyChangesRequestedIndentation: true, completionNotInvoked: true });
  } finally { await rm(root, { recursive: true, force: true }); }
}
assert.ok(rows.length, 'Pass built runtime directories.');
console.log(JSON.stringify({ classification: 'Exploratory direct executor replay. Source changes, parse acceptance, validation and task completion remain separate. No model or SDK loop simulation and no agent solution feedback.', rows }, null, 2));
