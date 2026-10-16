// SDK tool-definition JSON bytes, not billed prompt tokens or provider wire bytes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { publication } from './verify-public.mjs';
const repo = resolve(import.meta.dirname, '../../..');
const hash = text => createHash('sha256').update(text).digest('hex');
const root = await mkdtemp(join(tmpdir(), 'blame-declaration-schema-'));
try {
  const arms = {}, definitions = {};
  for (const arm of ['reference', 'candidate']) {
    const directory = join(root, arm);
    await mkdir(directory);
    if (arm === 'candidate') await cp(join(root, 'reference/runtime'), join(directory, 'runtime'), { recursive: true });
    const archive = arm === 'reference' ? 'reference-runtime.tar.gz' : 'candidate-overlay.tar.gz';
    const manifest = JSON.parse(await readFile(join(publication, `${arm}-runtime.json`), 'utf8'));
    assert.equal(hash(await readFile(join(publication, archive))), manifest.archiveSha256);
    execFileSync('tar', ['-xzf', join(publication, archive), '-C', directory]);
    await symlink(join(repo, 'packages/agent-runtime/node_modules'), join(directory, 'node_modules'));
    await writeFile(join(directory, 'package.json'), '{"type":"module"}\n');
    const mod = await import(pathToFileURL(join(directory, 'runtime/harness/light-tools.js')).href);
    const tools = mod.lightSemanticHarnessTools('/unused', { executor: async () => { throw Error('Never execute a tool in a schema measurement'); } });
    definitions[arm] = Object.fromEntries(tools.map(tool => [tool.name, JSON.stringify(tool)]));
    arms[arm] = { totalBytes: Buffer.byteLength(JSON.stringify(tools)),
      tools: Object.fromEntries(tools.map(tool => [tool.name, { bytes: Buffer.byteLength(JSON.stringify(tool)), sha256: hash(JSON.stringify(tool)) }])) };
  }
  for (const name of ['search_code', 'edit_code', 'run_task']) assert.equal(definitions.reference[name], definitions.candidate[name]);
  const deltaBytes = arms.candidate.totalBytes - arms.reference.totalBytes;
  process.stdout.write(JSON.stringify({ scope: 'SDK JSON definitions for four workspace tools; finish_task unchanged separately; not billed tokens/wire bytes', arms, deltaBytes, modelRequests: 0 }, null, 2) + '\n');
} finally { await rm(root, { recursive: true, force: true }); }
