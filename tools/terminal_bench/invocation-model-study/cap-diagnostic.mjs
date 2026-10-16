// Existing configured-cap controls versus actual recorded OAuth request fields.
// No model requests or authentication; unknown drop layer remains unknown.
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { repo, study } from './paths.mjs';
import { appendProductionConfig } from '../../../packages/agent-runtime/dist/production.js';
const protocol = JSON.parse(await readFile(join(study, 'protocol.json')));
const inventory = JSON.parse(await readFile(join(study, 'inventory.json')));
const nominal = protocol.budgets.requestMaxOutputTokens;
const configured = appendProductionConfig({ providerId: protocol.provider, modelId: protocol.model, maxTokensPerTurn: 128000 }, { requestMaxOutputTokens: nominal });
const sdk = await realpath(join(repo, 'packages/agent-runtime/node_modules/@cline/sdk/package.json'));
const core = await import(pathToFileURL(join(dirname(sdk), '../core/dist/index.js')));
const split = core.splitCoreSessionConfig({ providerId: protocol.provider, modelId: protocol.model, maxTokensPerTurn: configured.maxTokensPerTurn });
const trials = [];
for (const item of inventory) {
  const archive = JSON.parse(gunzipSync(await readFile(join(study, item.artifact))));
  const wire = Buffer.from(archive.files['wire-contracts.jsonl'].base64, 'base64').toString().trim().split('\n').filter(Boolean).map(JSON.parse);
  trials.push({ name: item.name, forwardedRequests: wire.filter(q => !q.budgetRejected).length,
    requestsWithNominalCap: wire.filter(q => !q.budgetRejected && q.maximumOutputTokens === nominal).length,
    requestsWithAbsentCap: wire.filter(q => !q.budgetRejected && q.maximumOutputTokens == null).length,
    originalWireSha256: archive.files['wire-contracts.jsonl'].sha256 });
}
const result = { paidRequests: 0, nominalCap: nominal, applicationConfigMaxTokensPerTurn: configured.maxTokensPerTurn,
  coreSplitConfigMaxTokensPerTurn: split.config.maxTokensPerTurn, trials,
  finding: 'Configuration assembly and Core config splitting preserve the nominal cap; actual forwarded OAuth requests omit it. Existing legacy createHandler serializer tests alone do not exercise this full runtime path.',
  unknown: 'Which later SDK/provider layer drops the limit, backend acceptance/enforcement and hidden reasoning accounting. Do not claim a transport fix or classify all128000 reported output tokens as reasoning.',
  next: 'Trace the complete SDK start/model-creation path with offline request capture, then preregister one bounded backend-acceptance probe before a quality/resource comparison. Keep F34 frozen.' };
await writeFile(join(study, 'cap-path-diagnostic.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ paidRequests: 0, nominal, applicationConfig: configured.maxTokensPerTurn, coreSplit: split.config.maxTokensPerTurn, forwardedRequests: trials.reduce((n, t) => n + t.forwardedRequests, 0), requestsWithNominalCap: trials.reduce((n, t) => n + t.requestsWithNominalCap, 0) }));
