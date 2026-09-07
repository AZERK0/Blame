import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
const { createHandler } = await import('../../../packages/agent-runtime/node_modules/@cline/llms/dist/index.js');
const root = '.blame/benchmarks/terminal-bench-frontier-v7-20260907';
const path = `${root}/jobs/batch-01/financial-document-processor__xxmeJNp/agent/events.jsonl`;
const events = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line).event);
const calls = events.filter(event => event.type === 'tool' && event.payload.phase === 'finished').map(event => event.payload);
const images = calls.filter(call => Array.isArray(call.output) && call.output.some(block => block.type === 'image'));
const first = [...new Map(images.map(call => [call.toolCall.input.target, call])).values()];

function conversation(calls) {
  return calls.flatMap((call, index) => [
    {role: 'assistant', content: [{type: 'tool_use', id: `image-${index}`, name: 'read_code', input: call.toolCall.input}]},
    {role: 'user', content: [{type: 'tool_result', tool_use_id: `image-${index}`, name: 'read_code', content: call.output}]},
  ]);
}

async function capture(calls) {
  let body;
  const handler = createHandler({providerId: 'openai-codex', modelId: 'gpt-5.6-luna', apiKey: 'offline-placeholder', accessToken: 'offline-placeholder', baseUrl: 'https://offline.invalid', fetch: async (input, init) => {
    assert.equal(String(input), 'https://offline.invalid/responses');
    body = JSON.parse(init.body);
    return new Response('{"error":{"message":"Offline capture","type":"invalid_request_error"}}', {status: 400, headers: {'content-type': 'application/json'}});
  }});
  try { for await (const ignored of handler.createMessage('Inspect local images.', conversation(calls), [])) {} } catch {}
  assert.ok(body, 'No provider request captured');
  const text = JSON.stringify(body.input);
  return {requestedImages: calls.length, requestedEncodedBytes: calls.flatMap(call => call.output).filter(block => block.type === 'image').reduce((sum, block) => sum + block.data.length, 0), transmittedImages: text.split('"type":"input_image"').length - 1, omittedPlaceholders: text.split('[media omitted: invalid or exceeds size limit]').length - 1};
}

const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw Error('Unexpected network access'); };
try {
  const result = {note: 'Actual SDK boundary replay with a rejecting local fetch stub. No request reaches a provider; no credentials or image data are published.', single: await capture(first.slice(0, 1)), distinct: await capture(first), repeated: await capture([...first, ...first])};
  writeFileSync(`${root}/image-provider-replay.json`, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { globalThis.fetch = previousFetch; }
