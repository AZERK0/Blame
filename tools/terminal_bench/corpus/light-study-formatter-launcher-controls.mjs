// Exploratory controls: change the launcher's reporter only, using isolated fixtures.
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const runtime = resolve(process.argv[2]);
const { DeterministicFormatter } = await import(pathToFileURL(join(runtime, 'dist/harness/deterministic-formatter.js')));
const { WorkspaceFiles } = await import(pathToFileURL(join(runtime, 'dist/harness/workspace-files.js')));
const root = await mkdtemp(join(tmpdir(), 'blame-formatter-launcher-'));
const rows = [];
try {
  for (const [id, command, silent] of [
    ['pnpm-exec', 'pnpm exec prettier --write first.ts', false],
    ['pnpm-exec-silent', 'pnpm exec prettier --write first.ts', true],
    ['pnpm-alias-silent', 'pnpm prettier --write first.ts', true],
  ]) {
    const cwd = join(root, id);
    await mkdir(join(cwd, 'node_modules/.bin'), { recursive: true });
    await writeFile(join(cwd, 'package.json'), JSON.stringify({ devDependencies: { prettier: '3.0.0' } }));
    const executable = ['#!/usr/bin/env node', 'let source = "";',
      'process.stdin.setEncoding("utf8");',
      'process.stdin.on("data", chunk => { source += chunk; });',
      'process.stdin.on("end", () => process.stdout.write(source.replace(/const (\\w+)=\\{value:(\\d+)\\}/gu, "const $1 = { value: $2 };")));'].join('\n');
    await writeFile(join(cwd, 'node_modules/.bin/prettier'), executable);
    await chmod(join(cwd, 'node_modules/.bin/prettier'), 0o755);
    await writeFile(join(cwd, 'first.ts'), 'export const first={value:1}\n');
    const formatter = new DeterministicFormatter(new WorkspaceFiles(cwd));
    const request = formatter.request(command);
    if (silent) request.args.unshift('--reporter=silent');
    const result = await formatter.format(request, cwd);
    const exact = result[0].content === 'export const first = { value: 1 };\n';
    rows.push({ id, executable: request.executable, args: request.args, exactSourceOutput: exact,
      outputBytes: Buffer.byteLength(result[0].content), sourceOutput: result[0].content });
    if (silent) assert.ok(exact, id);
  }
} finally { await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ classification: 'Exploratory direct-launcher control; no runtime implementation or model comparison. Observed pnpm behavior is environment-dependent. The fake local formatter and manifest intentionally reproduce the existing test fixture.', rows }, null, 2));
