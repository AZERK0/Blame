// Research-only feasibility treatment. Never installed in the production runtime.
import { appendFileSync } from 'node:fs';
const destination = process.env.BLAME_CAP_PROBE_AUDIT;
const cap = Number(process.env.BLAME_CAP_PROBE_LIMIT);
if (!destination || !Number.isSafeInteger(cap) || cap < 1) throw Error('Invalid registered cap probe');
const originalFetch = globalThis.fetch;
let forwarded = 0;
const record = value => appendFileSync(destination, JSON.stringify({ atUTC: new Date().toISOString(), ...value }) + '\n');
globalThis.fetch = async function capProbeFetch(input, init) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  const raw = typeof init?.body === 'string' ? init.body : input instanceof Request && input.method === 'POST' ? await input.clone().text() : undefined;
  let body; try { body = JSON.parse(raw); } catch {}
  if (!body || typeof body.model !== 'string' || !(body.input || body.messages)) return originalFetch(input, init);
  if (url.hostname !== 'chatgpt.com' || url.pathname !== '/backend-api/codex/responses') throw Error('Unexpected model endpoint; probe refused before dispatch');
  if (forwarded >= 1) { record({ type: 'blocked_extra_attempt', model: body.model }); throw Error('Registered one-request cap probe exhausted; no additional request sent'); }
  forwarded++;
  const patched = JSON.stringify({ ...body, max_output_tokens: cap });
  record({ type: 'forwarded_attempt', model: body.model, originalMaximumOutputTokens: body.max_output_tokens ?? null,
    injectedMaximumOutputTokens: cap, reasoning: body.reasoning ?? null, requestBytes: Buffer.byteLength(patched) });
  const response = await originalFetch(input, { ...init, body: patched });
  record({ type: 'http_response', status: response.status });
  if (!response.body) return response;
  const [consumer, audit] = response.body.tee();
  const auditResponse = async () => {
    const reader = audit.getReader(); const decoder = new TextDecoder();
    let buffer = '', bytes = 0;
    const inspectLine = line => {
      if (!line.startsWith('data:')) return;
      let event; try { event = JSON.parse(line.slice(5).trim()); } catch { return; }
      if (['response.completed', 'response.incomplete', 'response.failed'].includes(event.type)) {
        const r = event.response ?? {};
        record({ type: 'response_terminal', eventType: event.type, status: r.status ?? null,
          incompleteReason: r.incomplete_details?.reason ?? null, usage: r.usage ?? null });
      }
    };
    try {
      while (true) {
        const next = await reader.read(); if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 4 * 1024 * 1024) { record({ type: 'audit_limit', bytes }); await reader.cancel(); return; }
        buffer += decoder.decode(next.value, { stream: true });
        if (response.ok) {
          const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
          for (const line of lines) inspectLine(line);
        }
      }
      buffer += decoder.decode();
      if (!response.ok) {
        let value; try { value = JSON.parse(buffer); } catch {}
        const e = value?.error ?? value;
        record({ type: 'http_error', status: response.status, errorType: e?.type ?? null,
          code: e?.code ?? null, parameter: e?.param ?? null,
          message: typeof e?.message === 'string' ? e.message.slice(0, 400) : null });
      } else if (buffer) inspectLine(buffer);
      record({ type: 'audit_complete', bytes });
    } catch (error) { record({ type: 'audit_interrupted', error: error.name }); }
  };
  void auditResponse();
  return new Response(consumer, { status: response.status, statusText: response.statusText, headers: response.headers });
};
