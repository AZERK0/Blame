import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
const { lightRunTaskInputSchema } = await import(resolve("packages/agent-runtime/dist/harness/light-contracts.js"));
const { lightSemanticHarnessTools } = await import(resolve("packages/agent-runtime/dist/harness/light-tools.js"));

const sdkPath = await realpath("packages/agent-runtime/node_modules/@cline/sdk");
const { ClineCore, setClineDir } = await import(join(dirname(sdkPath), "core/dist/index.js"));
const directory = await mkdtemp(join(tmpdir(), "blame-command-schema-"));
const eventPath = ".blame/benchmarks/terminal-bench-frontier-v10b-20260908/jobs/batch-01/dna-assembly__ymdUUG8/agent/events.jsonl";
const lines = (await readFile(eventPath, "utf8")).split("\n");
const recorded = [314, 482].map(line => ({ line, input: JSON.parse(lines[line - 1]).event.payload.toolCall.input }));
const replays = recorded.map(({ line, input }) => {
  const result = lightRunTaskInputSchema.parse(input);
  assert.deepEqual(result, { ...input, kind: "command" });
  return { line, inputSha256: createHash("sha256").update(JSON.stringify(input)).digest("hex"), inferredKind: result.kind, commandUnchanged: result.command === input.command };
});
assert.equal(lightRunTaskInputSchema.safeParse(JSON.parse(lines[451]).event.payload.toolCall.input).success, false);
const requests = [];
const capture = async (input, init) => {
  assert.equal(new URL(String(input)).hostname, "offline.invalid");
  const request = JSON.parse(init.body);
  const tool = request.tools.find(tool => tool.name === "run_task");
  assert.ok(tool);
  requests.push(tool);
  return new Response('{"error":{"message":"Offline capture","type":"invalid_request_error"}}', { status: 400, headers: { "content-type": "application/json" } });
};
setClineDir(join(directory, "cline"));
await mkdir(join(directory, "workspace"));
globalThis.fetch = async () => { throw Error("Unexpected network access"); };
const logger = { log() {}, debug() {} };
const core = await ClineCore.create({ backendMode: "local", distinctId: "offline-fixture", clientName: "offline-fixture", logger, fetch: capture, automation: false });
try {
  try {
    await core.start({ config: {
      sessionId: "offline-command", providerId: "openai-codex", modelId: "gpt-5.6-luna", apiKey: "offline-fixture",
      providerConfig: { providerId: "openai-codex", modelId: "gpt-5.6-luna", accessToken: "offline-fixture", apiKey: "offline-fixture", baseUrl: "https://offline.invalid/v1" },
      baseUrl: "https://offline.invalid/v1", cwd: join(directory, "workspace"), workspaceRoot: join(directory, "workspace"),
      systemPrompt: "Inspect inputs.", maxIterations: 1, enableTools: true, extraTools: lightSemanticHarnessTools(join(directory, "workspace")),
      enableSpawnAgent: false, enableAgentTeams: false, disableMcpSettingsTools: true, checkpoint: { enabled: false }, compaction: { enabled: false }
    }, localRuntime: { configExtensions: [] }, prompt: "Inspect the workspace.", interactive: false });
  } catch {}
  assert.ok(requests.length, "No provider-bound schema captured");
  const result = { note: "Real SDK session with rejecting offline fetch; no credentials, network or recorded commands executed. Recorded command bodies are hashed only.", replays, corruptInputStillRejected: true, schemas: requests };
  await writeFile(".blame/benchmarks/harness-iterations-20260908/command-schema-replay.json", JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ recovered: replays.length, corruptInputStillRejected: true, capturedRequests: requests.length, providerSchema: requests[0].parameters }));
} finally {
  await core.dispose();
  await rm(directory, { recursive: true, force: true });
}
