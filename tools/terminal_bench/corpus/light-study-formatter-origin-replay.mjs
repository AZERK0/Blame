import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const found = spawnSync('which', ['pnpm'], { encoding: 'utf8' });
assert.equal(found.status, 0);
const realPnpm = found.stdout.trim();
const rows = [];
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, 'dist/harness/light-workspace.js')));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, 'dist/harness/session-journal.js')));
  const root = await mkdtemp(join(tmpdir(), 'blame-formatter-origin-'));
  const spy = await mkdtemp(join(tmpdir(), 'blame-formatter-spy-'));
  const originalPath = process.env.PATH;
  try {
    await mkdir(join(root, 'node_modules/.bin'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ devDependencies: { prettier: '3.0.0' } }));
    await writeFile(join(root, 'node_modules/.bin/prettier'), '#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout);\n');
    await chmod(join(root, 'node_modules/.bin/prettier'), 0o755);
    const log = join(spy, 'calls.jsonl');
    const config = JSON.stringify({ realPnpm, originalPath, log });
    const wrapper = ['#!' + process.execPath,
      'const fs=require("node:fs"),cp=require("node:child_process"),crypto=require("node:crypto");',
      'const cfg=' + config + ';',
      'const input=fs.readFileSync(0),args=process.argv.slice(2);',
      'const result=cp.spawnSync(cfg.realPnpm,args,{cwd:process.cwd(),env:{...process.env,PATH:cfg.originalPath},input,maxBuffer:4*1024*1024});',
      'const sha=b=>crypto.createHash("sha256").update(b||Buffer.alloc(0)).digest("hex");',
      'fs.appendFileSync(cfg.log,JSON.stringify({args,cwd:process.cwd(),exitCode:result.status,inputSha256:sha(input),stdoutSha256:sha(result.stdout)})+"\\n");',
      'if(result.stdout)process.stdout.write(result.stdout);if(result.stderr)process.stderr.write(result.stderr);',
      'process.exitCode=result.status??1;'].join('\n');
    await writeFile(join(spy, 'pnpm'), wrapper);
    await chmod(join(spy, 'pnpm'), 0o755);
    process.env.PATH = spy + ':' + originalPath;
    const sources = { 'first.ts': 'export const first = { value: 1 };\n', 'second.ts': 'export const second = { value: 2 };\n' };
    for (const [path, source] of Object.entries(sources)) await writeFile(join(root, path), source);
    const workspace = new LightWorkspace(root, { sessionId: 'formatter-origin', taskContract: {
      session_id: 'formatter-origin', objective: 'format two explicit files', acceptance_criteria: ['truthful evidence origin'], effect_requirement: 'none',
    } });
    const results = [];
    for (const path of Object.keys(sources)) {
      const result = await workspace.tasks.run({ kind: 'command', command: 'pnpm exec prettier --write ' + path });
      assert.equal(result.status, 'ok');
      assert.equal(result.data.changed, false);
      assert.equal(await readFile(join(root, path), 'utf8'), sources[path]);
      results.push(result);
    }
    const snapshot = await new SessionJournal(root, 'formatter-origin').completionSnapshot();
    const calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(c=>c.exitCode===0 && c.args.includes('--stdin-filepath') && !c.args.includes('--check')));
    assert.equal(snapshot.validations.length, 2, 'Same-revision evidence for distinct formatter scopes must not collapse.');
    assert.ok(snapshot.validations.every(v=>v.status==='passed' && v.sourceRevisionId===snapshot.sourceRevisionId));
    assert.deepEqual(snapshot.validations.flatMap(v=>v.paths).sort(), Object.keys(sources).sort());
    assert.deepEqual(snapshot.changedPaths, []);
    rows.push({ runtime, results, actualInvocations: calls, validations: snapshot.validations,
      executedCheckCommands: 0, syntheticCheckLabels: snapshot.validations.filter(v=>/\bprettier --check\b/.test(v.command??'')).length,
      derivedOriginLabels: snapshot.validations.filter(v=>v.evidenceOrigin==='formatter_output').length,
      distinctScopeEvidenceRetained: true, exactSourceAndNoMutation: true, completionNotInvoked: true });
  } finally {
    if (originalPath === undefined) delete process.env.PATH; else process.env.PATH = originalPath;
    await rm(root, { recursive: true, force: true }); await rm(spy, { recursive: true, force: true });
  }
}
assert.ok(rows.length, 'Pass built runtime directories.');
console.log(JSON.stringify({ classification: 'Direct local formatter/journal replay with actual argv/exit and source-byte hashes. No environment credentials recorded; PATH interception delegates unchanged args/input to actual pnpm and restores its real PATH. No model calls or task completion.', rows }, null, 2));
