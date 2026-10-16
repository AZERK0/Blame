// Offline full public SDK bootstrap. All HTTP is intercepted; no credentials or
// request headers are captured. This is distinct from the legacy handler test.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const repo = resolve(new URL('../../..', import.meta.url).pathname);
const output = resolve(process.argv[2] ?? join(repo, '.blame/research/request-limits-f35/core-before.json'));
const baseUrl = process.argv[3];
const root = await mkdtemp(join(tmpdir(), 'f35-sdk-cap-'));
const sessionId = 'f35-offline-' + randomUUID();
const requests = [], events = [];
const offline = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const raw = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.clone().text() : '';
  let body; try { body = JSON.parse(raw); } catch {}
  requests.push({ origin: url.origin, path: url.pathname, method: init?.method ?? 'GET',
    model: body?.model ?? null, maximumOutputTokens: body?.max_output_tokens ?? null,
    reasoning: body?.reasoning ?? null });
  throw new Error('F35 offline HTTP capture; request not transmitted');
};
globalThis.fetch = offline;
let core, session, error;
const timer = setTimeout(() => { void finish('offline capture watchdog'); }, 20000);
let completed = false;
async function finish(message) {
  if (completed) return;
  completed = true;
  clearTimeout(timer);
  if (session) {
    try { await core.abort(sessionId); } catch {}
    try { await core.delete(sessionId); } catch {}
  }
  await writeFile(output, JSON.stringify({ paidRequests: 0, requests, events, error: message ?? error ?? null }, null, 2) + '\n');
  console.log(JSON.stringify({ paidRequests: 0, requests, error: message ?? error ?? null }));
  await rm(root, { recursive: true, force: true });
  // The SDK has process-global local-storage handles. End only this dedicated
  // child after its receipt is durable; never terminate another worker.
  process.exit(0);
}
try {
  await writeFile(join(root, 'package.json'), '{"name":"offline-sdk-cap","type":"module"}\n');
  const { ClineCore } = await import(pathToFileURL(join(repo, 'packages/agent-runtime/node_modules/@cline/sdk/dist/index.js')));
  const { appendProductionConfig } = await import(pathToFileURL(join(repo, 'packages/agent-runtime/dist/production.js')));
  core = await ClineCore.create({ backendMode: 'local', clientName: 'f35-offline-cap', distinctId: 'f35-offline-cap', fetch: offline });
  session = await core.start({ prompt: 'Reply OK.', config: appendProductionConfig({
    sessionId, providerId: 'openai-codex', modelId: 'gpt-5.6-luna', apiKey: 'offline-placeholder',
    ...(baseUrl ? { baseUrl } : {}),
    systemPrompt: 'Offline cap contract probe.', cwd: root, workspaceRoot: root,
    enableTools: false, enableSpawnAgent: false, enableAgentTeams: false,
    checkpoint: { enabled: false }, maxIterations: 1, reasoningEffort: 'high',
  }, { requestMaxOutputTokens: 8192 }) });
  const poll = async () => {
    if (requests.length) { await finish(); return; }
    if (!completed) setTimeout(() => { void poll(); }, 100);
  };
  void poll();
} catch (e) { error = String(e.message).slice(0, 500); await finish(); }
