// End-to-end SDK serialization controls, all HTTP intercepted, no model requests.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
const repo = resolve(new URL('../../..', import.meta.url).pathname);
const runtime = resolve(process.env.BLAME_CAP_RUNTIME ?? join(repo, 'packages/agent-runtime/dist'));
if (process.argv[2] === 'child') {
  const name = process.argv[3], maximum = name === 'unconfigured' ? undefined : 8192;
  const root = await mkdtemp(join(tmpdir(), 'f35-sdk-contract-'));
  const sessionId = 'f35-contract-' + randomUUID(), captures = [];
  globalThis.fetch = async () => { throw Error('Unexpected offline HTTP path; never forwarded'); };
  const { createProviderCompatibleFetch } = await import(pathToFileURL(join(runtime, 'provider-schema-compatibility.js')));
  const { ClineCore } = await import(pathToFileURL(join(repo, 'packages/agent-runtime/node_modules/@cline/sdk/dist/index.js')));
  const request = async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : await input.clone().text());
    captures.push({ origin: url.origin, model: body.model, maximumOutputTokens: body.max_output_tokens ?? null });
    throw Error('Offline full-SDK capture; no transmission');
  };
  const core = await ClineCore.create({ backendMode: 'local', clientName: 'f35-contract', distinctId: 'f35-offline',
    fetch: createProviderCompatibleFetch(request, { requestMaxOutputTokens: maximum }) });
  let timer;
  const stop = async () => {
    clearTimeout(timer);
    try { await core.abort(sessionId); } catch {}
    try { await core.delete(sessionId); } catch {}
    await rm(root, { recursive: true, force: true });
    console.log(JSON.stringify({ name, captures, paidRequests: 0 }));
    process.exit(0);
  };
  timer = setTimeout(() => { void stop(); }, 20000);
  await writeFile(join(root, 'package.json'), '{"type":"module"}\n');
  await core.start({ prompt: 'Reply OK.', config: { sessionId, providerId: 'openai-codex', modelId: 'gpt-5.6-luna',
    apiKey: 'offline-placeholder', systemPrompt: 'Offline request cap contract.', cwd: root, workspaceRoot: root,
    ...(name === 'other-origin' ? { baseUrl: 'https://offline.invalid/v1' } : {}),
    ...(maximum === undefined ? {} : { maxTokensPerTurn: maximum }),
    enableTools: false, enableSpawnAgent: false, enableAgentTeams: false, maxIterations: 1,
    reasoningEffort: 'high', checkpoint: { enabled: false } } });
  await stop();
} else {
  const rows = [];
  for (const [name, expected] of [['configured', 8192], ['unconfigured', null], ['other-origin', 8192]]) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'child', name], {
      cwd: repo, encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024, env: process.env });
    const text = result.stdout.trim().split('\n').at(-1);
    let output; try { output = JSON.parse(text); } catch {}
    rows.push({ name, expected, exitCode: result.status, output: output ?? null,
      passed: result.status === 0 && output?.captures.length > 0 && output.captures.every(c => c.maximumOutputTokens === expected),
      ...(output ? {} : { setupError: (result.stderr + result.stdout).slice(-1000) }) });
  }
  const summary = { paidRequests: 0, rows, passed: rows.filter(r => r.passed).length, total: rows.length };
  if (process.argv[2]) await writeFile(resolve(process.argv[2]), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  assert.equal(summary.passed, summary.total);
}
