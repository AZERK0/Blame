import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const { LightWorkspace } = await import(pathToFileURL(resolve('packages/agent-runtime/dist/harness/light-workspace.js')).href);
const eventLine = Number(process.argv[2] ?? 205);

const campaign = resolve('.blame/benchmarks/terminal-bench-frontier-v9-20260907');
const trace = join(campaign, 'jobs/batch-04/winning-avg-corewars__s3MGw9u/agent/events.jsonl');
const events = (await readFile(trace, 'utf8')).split('\n').flatMap((line, index) => line ? [{ ...JSON.parse(line), line: index + 1 }] : []);
const root = await mkdtemp(join(tmpdir(), 'blame-patch-effect-replay-'));
const workspace = new LightWorkspace(root, { sessionId: 'offline-patch-effect-replay' });
const digest = (value) => createHash('sha256').update(value).digest('hex');

function patchHunks(patch) {
  const hunks = [];
  for (const line of patch.trimEnd().split('\n').slice(2, -1)) {
    if (line === '@@') hunks.push([]);
    else {
      assert.ok(hunks.length && ['-', '+', ' '].includes(line[0]));
      hunks.at(-1).push(line);
    }
  }
  return hunks.map((body) => ({
    before: body.filter((line) => line[0] !== '+').map((line) => line.slice(1)),
    after: body.filter((line) => line[0] !== '-').map((line) => line.slice(1)),
  }));
}

function orderedEffects(lines, hunks, positions = [], cursor = 0) {
  if (positions.length === hunks.length) {
    const result = [...lines];
    for (let index = hunks.length - 1; index >= 0; index -= 1)
      result.splice(positions[index], hunks[index].before.length, ...hunks[index].after);
    return [{ lines: positions.map((position) => position + 1), sha256: digest(result.join('\n')) }];
  }
  const hunk = hunks[positions.length];
  const results = [];
  for (let index = cursor; index + hunk.before.length <= lines.length; index += 1) {
    if (!hunk.before.every((line, offset) => lines[index + offset] === line)) continue;
    results.push(...orderedEffects(lines, hunks, [...positions, index], index + hunk.before.length));
    assert.ok(results.length < 10_000, 'Offline enumeration bound exceeded');
  }
  return results;
}

function patchEffects(source, patch) {
  const matches = orderedEffects(source.split('\n'), patchHunks(patch));
  return { matches, distinctResults: new Set(matches.map((result) => result.sha256)).size };
}

try {
  for (const row of events.filter((event) => [66, 85, 111].includes(event.line))) {
    const result = await workspace.editCode(row.event.payload.toolCall.input, {});
    assert.equal(result.status, 'ok', JSON.stringify(result));
    await workspace.readCode({ target: 'my_warrior.red', view: 'raw' }, {});
  }
  const source = await readFile(join(root, 'my_warrior.red'), 'utf8');
  const selected = events.find((row) => row.line === eventLine);
  const input = selected.event.payload.toolCall.input;
  const result = await workspace.editCode(input, {});
  const analysis = { trial: 'winning-avg-corewars__s3MGw9u', eventLine, recordedStatus: selected.event.payload.output.status,
    reconstruction: 'Three recorded successful edits; intervening inspected commands do not write this target.',
    sourceBytes: Buffer.byteLength(source), sourceSha256: digest(source), status: result.status,
    actualContentSha256: digest(await readFile(join(root, 'my_warrior.red'), 'utf8')),
    effects: patchEffects(source, input.operations[0].patch),
    note: 'Analyst-only exact-content replay; no commands, provider request, verifier, or official solution executed. Acceptance does not imply task success.' };
  await writeFile(join(campaign, `patch-effect-replay-${eventLine}-after.json`), JSON.stringify(analysis, null, 2) + '\n');
  console.log(JSON.stringify(analysis));
} finally {
  await rm(root, { recursive: true, force: true });
}
