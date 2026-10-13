// Zero-paid controls for the actual installed SDK's authentication transports
// and the common research-only pre-dispatch guard.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHandler } from "../../../packages/agent-runtime/node_modules/@cline/llms/dist/index.js";

const destination = resolve(process.argv[2]);
const work = resolve(process.argv[3]);
await mkdir(work, { recursive: true });
const transports = [];
for (const mode of ["api_key", "oauth"]) {
  const requests = [];
  const handler = createHandler({ providerId: "openai-codex", modelId: "gpt-5.6-luna",
    reasoningEffort: "high", maxOutputTokens: 8192, accessToken: "offline-placeholder",
    ...(mode === "api_key" ? { apiKey: "offline-placeholder", baseUrl: "https://offline.invalid" } : {}),
    fetch: async (input, init) => {
      const body = JSON.parse(init.body);
      requests.push({ endpoint: String(input), bodyKeys: Object.keys(body),
        maximumOutputTokens: body.max_output_tokens ?? body.max_tokens ?? null });
      return new Response("Offline auth transport probe", { status: 400 });
    } });
  try { for await (const _chunk of handler.createMessage("offline", [{ role: "user", content: "offline" }])) {} }
  catch {}
  assert.equal(requests.length, 1);
  assert.equal(requests[0].maximumOutputTokens, mode === "api_key" ? 8192 : null);
  transports.push({ mode, ...requests[0], paidRequests: 0 });
}
const forwarded = [];
globalThis.fetch = async (input, init) => { forwarded.push({ input, init }); return new Response("offline"); };
process.env.BLAME_STUDY_WIRE_AUDIT = join(work, "wire-contracts.jsonl");
process.env.BLAME_STUDY_REQUEST_MAX_BYTES = "1000";
await import("./wire-audit.mjs");
const small = JSON.stringify({ model: "offline-model", input: [], tools: [], instructions: "offline" });
await fetch("https://offline.invalid/responses", { method: "POST", body: small });
assert.equal(forwarded[0].init.body, small);
const large = JSON.stringify({ model: "offline-model", input: [{ content: "é".repeat(600) }] });
assert.ok(Buffer.byteLength(large) > 1000);
await assert.rejects(fetch("https://offline.invalid/responses", { method: "POST", body: large }), /before dispatch/);
assert.equal(forwarded.length, 1);
await fetch("https://offline.invalid/credential-broker", { method: "POST", body: JSON.stringify({ access: "offline" }) });
assert.equal(forwarded.length, 2);
const wire = (await readFile(process.env.BLAME_STUDY_WIRE_AUDIT, "utf8")).trim().split("\n").map(JSON.parse);
assert.equal(wire.length, 2);
assert.equal(wire[0].budgetRejected, false);
assert.equal(wire[1].budgetRejected, true);
assert.equal(wire[1].requestBytes, Buffer.byteLength(large));
const reserve = (290000 + 10000) * .25 / 1e6 + 128000 * 1.2 / 1e6;
assert.ok(reserve <= .23);
await writeFile(destination, JSON.stringify({ method: "Explicit mock fetch and fake credentials; zero real HTTP requests.",
  transports, guard: { unmodifiedForwarding: true, utf8Bytes: true, rejectedBeforeDispatch: true,
    nonModelBrokerUnaffected: true, estimatedFinalRequestUsd: reserve, paidRequests: 0 } }, null, 2) + "\n");
console.log(JSON.stringify({ transports: transports.length, guardChecks: 4, paidRequests: 0, reserve }));
