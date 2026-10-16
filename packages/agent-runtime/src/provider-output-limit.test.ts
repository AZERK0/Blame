import assert from "node:assert/strict";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const runtime = process.env.BLAME_CAP_RUNTIME;
const { createProviderCompatibleFetch } = await import(runtime
  ? pathToFileURL(resolve(runtime, "provider-schema-compatibility.js")).href
  : "./provider-schema-compatibility.js") as typeof import("./provider-schema-compatibility.js");
const endpoint = "https://chatgpt.com/backend-api/codex/responses";
const payload = { model: "offline-model", input: [{ role: "user", content: "literal input" }] };

function capture() {
  const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];
  const request: typeof fetch = async (input, init) => {
    const signal = init?.signal === undefined && input instanceof Request ? input.signal : init?.signal;
    signal?.throwIfAborted();
    calls.push({ input, init });
    return new Response(null, { status: 204 });
  };
  return { calls, request };
}

test("an explicitly configured cap reaches a Codex request whose gateway omitted it", async () => {
  const { calls, request } = capture();
  await createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 })(endpoint, {
    method: "POST", body: JSON.stringify(payload),
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { ...payload, max_output_tokens: 8192 });
});

test("a stricter existing cap is preserved and a larger cap is reduced", async () => {
  const { calls, request } = capture();
  const limited = createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 });
  for (const [existing, expected] of [[512, 512], [16384, 8192]]) {
    const body = JSON.stringify({ ...payload, max_output_tokens: existing });
    await limited(endpoint, { method: "POST", body });
    assert.equal(JSON.parse(calls.at(-1)!.init!.body as string).max_output_tokens, expected);
    if (existing === expected) assert.equal(calls.at(-1)!.init!.body, body);
  }
});

test("unconfigured output behavior and other origins/endpoints remain unchanged", async () => {
  const { calls, request } = capture();
  const body = JSON.stringify(payload);
  await createProviderCompatibleFetch(request)(endpoint, { method: "POST", body });
  for (const url of ["https://api.openai.com/v1/responses", "https://chatgpt.com.evil.invalid/backend-api/codex/responses",
    "https://chatgpt.com@offline.invalid/backend-api/codex/responses", "http://chatgpt.com/backend-api/codex/responses",
    "https://chatgpt.com/backend-api/codex/responses/cancel"]) {
    await createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 })(url, { method: "POST", body });
  }
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.init?.body === body));
});

test("Request bodies retain credentials and signal while rewritten content length is recomputed", async () => {
  const { calls, request } = capture();
  const body = JSON.stringify(payload);
  const controller = new AbortController();
  const input = new Request(endpoint, { method: "POST", body, signal: controller.signal,
    headers: { authorization: "Bearer offline-only", "x-offline": "retained", "content-length": String(Buffer.byteLength(body)) } });
  await createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 })(input);
  const forwarded = calls[0]!;
  const actualBody = typeof forwarded.init?.body === "string" ? forwarded.init.body : await input.clone().text();
  assert.equal(JSON.parse(actualBody).max_output_tokens, 8192);
  const headers = new Headers(forwarded.init?.headers ?? input.headers);
  assert.equal(forwarded.input, input);
  assert.equal(headers.get("authorization"), "Bearer offline-only");
  assert.equal(headers.get("x-offline"), "retained");
  assert.equal(headers.has("content-length"), false);
  assert.equal(input.bodyUsed, false);
  assert.equal((forwarded.input as Request).signal, input.signal);
});

test("invalid configured limits fail before any transport invocation", () => {
  const { calls, request } = capture();
  for (const cap of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => createProviderCompatibleFetch(request, { requestMaxOutputTokens: cap }), /positive safe integer/u);
  assert.equal(calls.length, 0);
});

test("malformed or uninspectable capped model requests cannot bypass the budget", async () => {
  const { calls, request } = capture();
  const limited = createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 });
  for (const body of ["not json", "{}", "[]"])
    await assert.rejects(limited(endpoint, { method: "POST", body }), /inspectable JSON model request/u);
  for (const cap of [0, -1, 1.5, "512", null])
    await assert.rejects(limited(endpoint, { method: "POST", body: JSON.stringify({ ...payload, max_output_tokens: cap }) }), /Invalid max_output_tokens/u);
  assert.equal(calls.length, 0);
});

test("abort is preserved and an explicit null signal retains fetch override semantics", async () => {
  const { calls, request } = capture();
  const limited = createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 });
  const controller = new AbortController(); controller.abort();
  const input = new Request(endpoint, { method: "POST", body: JSON.stringify(payload), signal: controller.signal });
  await assert.rejects(limited(input), { name: "AbortError" });
  assert.equal(calls.length, 0);
  await limited(input, { signal: null });
  assert.equal(calls[0]!.init!.signal, null);
});

test("non-inference GET requests do not acquire a model body", async () => {
  const { calls, request } = capture();
  await createProviderCompatibleFetch(request, { requestMaxOutputTokens: 8192 })(endpoint, { method: "GET" });
  assert.equal(calls[0]!.init!.body, undefined);
});
