// One registered backend feasibility attempt through the existing runner/auth.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const repo = resolve(new URL('../../..', import.meta.url).pathname);
const study = join(repo, 'docs/experiments/light-harness-request-limits-f35-2026-10-16');
const root = join(repo, '.blame/research/request-limits-f35/probe');
const bytes = await readFile(join(study, 'probe-protocol.json'));
const p = JSON.parse(bytes); const sha = b => createHash('sha256').update(b).digest('hex');
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
assert.equal(sha(execFileSync('git', ['show', head + ':' + join(study, 'probe-protocol.json').slice(repo.length + 1)], { cwd: repo })), sha(bytes), 'Commit registration before dispatch');
for (const [path, hash] of Object.entries(p.inputSha256)) assert.equal(sha(await readFile(join(repo, path))), hash, path);
for (const [key, value] of Object.entries({ BLAME_MODEL_ID: p.model, BLAME_PROVIDER_ID: p.provider, BLAME_REASONING_EFFORT: p.effort })) assert.equal(process.env[key], value, key);
assert.ok(process.env.BLAME_API_TOKEN && process.env.BLAME_API_URL);
await mkdir(root); await mkdir(join(root, 'workspace'));
await writeFile(join(root, 'workspace/package.json'), '{"name":"f35-budget-probe","type":"module"}\n');
await writeFile(join(root, 'instruction.txt'), p.instruction);
await writeFile(join(root, 'start.json'), JSON.stringify({ gitHead: head, startedAtUTC: new Date().toISOString(), protocolSha256: sha(bytes) }, null, 2) + '\n', { flag: 'wx' });
const args = ['--import', join(repo, 'tools/terminal_bench/navigation-evidence/wire-audit.mjs'),
  '--import', join(repo, 'tools/terminal_bench/request-limit-study/backend-probe-hook.mjs'),
  join(repo, 'packages/benchmark-runner/dist/cli.js'), 'run', '--workspace', join(root, 'workspace'),
  '--instruction-file', join(root, 'instruction.txt'), '--task-id', 'f35-cap-feasibility', '--harness', 'blame',
  '--events', join(root, 'events.jsonl'), '--result', join(root, 'result.json'),
  '--max-iterations', '1', '--timeout-seconds', String(p.timeoutSeconds)];
const child = spawn(process.execPath, args, { cwd: repo, detached: true, stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_ENV: 'development', BLAME_HEADLESS_DEV: 'true', TZ: 'UTC',
    BLAME_CAP_PROBE_LIMIT: String(p.injectedOutputCap), BLAME_CAP_PROBE_AUDIT: join(root, 'backend-audit.jsonl'),
    BLAME_STUDY_WIRE_AUDIT: join(root, 'wire-contracts.jsonl'), BLAME_STUDY_WORKSPACE: join(root, 'workspace'),
    BLAME_STUDY_REQUEST_MAX_BYTES: '290000',
    BLAME_AGENT_REQUEST_MAX_OUTPUT_TOKENS: String(p.injectedOutputCap), BLAME_AGENT_MAX_SESSION_COST_USD: String(p.softSessionCostUsd) } });
await writeFile(join(root, 'child.json'), JSON.stringify({ pid: child.pid }) + '\n', { flag: 'wx' });
let stderr = '', watchdog = false;
child.stderr.on('data', b => { if (stderr.length < 4000) stderr += b.toString(); });
const timer = setTimeout(() => { watchdog = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, (p.timeoutSeconds + 20) * 1000);
const exit = await new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
clearTimeout(timer);
await writeFile(join(root, 'exit.json'), JSON.stringify({ ...exit, watchdog,
  stderr: stderr.replaceAll(process.env.BLAME_API_TOKEN, '[REDACTED]'), finishedAtUTC: new Date().toISOString() }, null, 2) + '\n');
console.log(JSON.stringify({ ...exit, watchdog, root }));
