// Seven known F36 refused edits; no model, commands, source recovery or mutation.
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo, study, work, json, save, sha } from './setup.mjs';
const originalStudy = join(repo, 'docs/experiments/light-harness-request-limits-model-f36-2026-10-16');
const sourceArchive = join(repo, 'docs/experiments/light-harness-edit-boundaries-f31-2026-10-16/preparation/yaml-source.tar.gz');
const modules = {
  reference: await import(pathToFileURL(join(work, 'frozen/declarations/agent-runtime/dist/harness/light-workspace.js')).href),
  candidate: await import(pathToFileURL(join(repo, 'packages/agent-runtime/dist/harness/light-workspace.js')).href),
};
const { parseCode } = await import(pathToFileURL(join(repo, 'packages/agent-runtime/dist/harness/code-intelligence.js')).href);
const records = [];
for (const name of ['2-yaml-anchor-ranges-candidate', '3-yaml-anchor-ranges-candidate']) {
  const bytes = await readFile(join(originalStudy, 'traces', name + '.json.gz'));
  const archive = JSON.parse(gunzipSync(bytes));
  const eventBytes = Buffer.from(archive.files['events.jsonl'].base64, 'base64');
  assert.equal(sha(eventBytes), archive.files['events.jsonl'].sha256);
  const tools = eventBytes.toString().trim().split('\n').map(JSON.parse).map(row => row.event)
    .filter(event => event.type === 'tool' && event.payload.phase === 'finished').map(event => ({ ...event.payload,
      tool: event.payload.toolCall?.name ?? event.payload.tool, input: event.payload.toolCall?.input ?? event.payload.input }));
  const firstWrite = tools.findIndex(tool => tool.tool === 'edit_code' && tool.output?.status === 'ok');
  const failures = tools.map((tool, index) => ({ tool, index })).filter(({ tool }) => tool.tool === 'edit_code' && tool.output?.status !== 'ok');
  assert.ok(failures.every(row => row.index < firstWrite));
  assert.ok(tools.slice(0, firstWrite).every(tool => tool.tool !== 'run_task'), 'No omitted command may have changed the preimage');
  const path = 'src/compose/compose-node.ts';
  const fullRead = tools.find(tool => tool.tool === 'read_code' && tool.output?.data?.path === path && tool.output.data.complete && typeof tool.output.data.content === 'string');
  assert.ok(fullRead);
  const source = fullRead.output.data.content;
  const declarations = parseCode(path, Buffer.from(source)).symbols.filter(symbol => symbol.qualified_name === 'composeNode');
  assert.equal(declarations.length, 1);
  for (const arm of ['reference', 'candidate']) {
    const root = await mkdtemp(join(tmpdir(), 'f39-history-'));
    try {
      execFileSync('tar', ['-xzf', sourceArchive, '-C', root]);
      assert.equal((await readFile(join(root, path), 'utf8')), source, 'Archived and observed complete preimage agree');
      const workspace = new modules[arm].LightWorkspace(root, { sessionId: `${name}-${arm}` });
      await workspace.readCode({ target: path, view: 'raw' }, {});
      const selected = await workspace.readCode({ target: path + '#composeNode' }, {});
      assert.equal(selected.status, 'ok');
      const alias = selected.data.alias;
      for (const { tool, index } of failures) {
        const observed = JSON.parse(tool.output.recovery.slice(tool.output.recovery.indexOf('{')));
        assert.equal(observed.path, path); assert.equal(observed.target, tool.input.operations[0].target);
        assert.deepEqual(observed.declarationLines, declarations[0].line_range);
        const input = structuredClone(tool.input);
        for (const operation of input.operations) operation.target = alias;
        const started = performance.now();
        const result = await workspace.editCode(input);
        const durationMs = performance.now() - started;
        assert.equal(result.status, 'blocked'); assert.equal(await readFile(join(root, path), 'utf8'), source);
        const recovery = JSON.parse(result.recovery.slice(result.recovery.indexOf('{')));
        records.push({ originalTrial: name, originalToolIndex: index, arm, originalTraceSha256: sha(bytes),
          observedPreimageSha256: sha(source), originalInput: tool.input, normalizedInput: input,
          normalization: 'Ephemeral alias remapped to the same fully observed composeNode declaration; source and declaration lines verified. No successful edit or command precedes these original refusals.',
          status: result.status, reason: recovery.patchCorrection?.reason ?? null, nextRead: recovery.nextRead,
          durationMs, responseBytes: Buffer.byteLength(JSON.stringify(result)), result });
      }
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}
await save(join(study, 'cycle2-historical-replay.json'), { modelRequests: 0, sourceArchiveSha256: sha(await readFile(sourceArchive)), records });
console.log(JSON.stringify(Object.fromEntries(['reference', 'candidate'].map(arm => [arm, {
  refusedEdits: records.filter(row => row.arm === arm).length,
  outsideScopeDiagnostics: records.filter(row => row.arm === arm && row.reason === 'context_outside_symbol').length,
  totalResponseBytes: records.filter(row => row.arm === arm).reduce((sum, row) => sum + row.responseBytes, 0),
  totalDurationMs: records.filter(row => row.arm === arm).reduce((sum, row) => sum + row.durationMs, 0),
}]))));
