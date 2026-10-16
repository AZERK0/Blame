import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { publication, verify } from './verify-public.mjs';

const cases = [
  ['read-only receipt corrupted', 'replay-primary.json', value => {
    const row = value.records.find(row => row.arm === 'candidate');
    row.response.data.readOnly = false;
    row.responseBytes = Buffer.byteLength(JSON.stringify(row.response));
    value.arms.candidate.totalResponseBytes = value.records.filter(row => row.arm === 'candidate')
      .reduce((sum, row) => sum + row.responseBytes, 0);
  }],
  ['missing-usage reserve silently released', 'validation.json', value => { value.cumulative.observedSdkEstimatedUsd += 0.23; value.cumulative.missingUsageReserveUsd -= 0.23; }],
  ['historical refusal rewritten', 'historical-witness.json', value => { value.records[0].status = 'ok'; }],
];
await verify();
for (const [name, file, mutate] of cases) {
  const root = await mkdtemp(join(tmpdir(), 'blame-declaration-corruption-'));
  try {
    await cp(publication, root, { recursive: true });
    const value = JSON.parse(await readFile(join(root, file), 'utf8'));
    mutate(value);
    const bytes = JSON.stringify(value, null, 2) + '\n';
    await writeFile(join(root, file), bytes);
    // Rehash the inventory too: checks must reject inconsistent meaning,
    // not only accidental byte changes.
    const inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
    inventory[file] = createHash('sha256').update(bytes).digest('hex');
    await writeFile(join(root, 'inventory.json'), JSON.stringify(inventory));
    await assert.rejects(verify(root), undefined, name);
    process.stdout.write(`PASS: ${name}\n`);
  } finally { await rm(root, { recursive: true, force: true }); }
}
