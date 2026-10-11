// Descriptive all-case navigation and layout observations; no byte-to-token conversion.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
const directory = resolve(process.argv[2]);
const source = await readFile(join(directory, "results.json"));
const results = JSON.parse(source);
const rows = [];
for (const row of results.rows) {
  const raw = gunzipSync(await readFile(join(directory, "traces", row.name + ".events.jsonl.gz")));
  const tools = raw.toString().split("\n").filter(Boolean).map(line => JSON.parse(line).event)
    .filter(event => event?.type === "tool" && event.payload.phase === "finished")
    .map(event => ({ tool: event.payload.toolCall?.name ?? event.payload.tool,
      input: event.payload.toolCall?.input ?? event.payload.input,
      output: event.payload.output ?? event.payload.result }));
  const manifestReads = tools.map((tool, index) => ({ ...tool, index }))
    .filter(tool => tool.tool === "read_code" && tool.input.target === "package.json")
    .map(tool => ({ index: tool.index, input: tool.input, status: tool.output?.status,
      complete: tool.output?.data?.complete ?? null,
      returnedBytes: Buffer.byteLength(JSON.stringify(tool.output)),
      scriptsIncluded: (tool.output?.data?.content ?? "").includes('"scripts"') }));
  const manifestSearches = tools.map((tool, index) => ({ ...tool, index }))
    .filter(tool => tool.tool === "search_code" && tool.input.scope === "package.json")
    .map(tool => ({ index: tool.index, input: tool.input }));
  const bodyEdits = tools.map((tool, index) => ({ ...tool, index }))
    .filter(tool => tool.tool === "edit_code")
    .flatMap(tool => (tool.input.operations ?? [])
      .filter(operation => operation.kind === "symbol" && operation.action === "replace_body")
      .map(operation => ({ index: tool.index, target: operation.target,
        explicitlyBraced: /^\s*\{/u.test(operation.content),
        accepted: tool.output?.status === "ok", changed: tool.output?.data?.changed ?? null })));
  rows.push({ name: row.name, arm: row.arm, eventsSha256: createHash("sha256").update(raw).digest("hex"),
    manifestReads: row.arm === "cline" ? null : manifestReads,
    manifestSearches: row.arm === "cline" ? null : manifestSearches,
    bodyEdits: row.arm === "cline" ? null : bodyEdits,
    navigation: row.metrics?.navigation ?? null, composition: row.metrics?.context?.composition ?? null,
    toolPayloadReplayExposureBytes: row.metrics?.context?.toolPayloadReplayExposureBytes ?? null });
}
const summaries = Object.fromEntries(["baseline", "modified", "cline"].map(arm => {
  const selected = rows.filter(row => row.arm === arm);
  return [arm, { trials: selected.length,
    rawManifestReads: arm === "cline" ? null : selected.reduce((sum, row) =>
      sum + row.manifestReads.filter(read => !read.input.range).length, 0),
    incompleteManifestReadsOmittingScripts: arm === "cline" ? null : selected.reduce((sum, row) =>
      sum + row.manifestReads.filter(read => read.complete === false && !read.scriptsIncluded).length, 0),
    manifestRangeReads: arm === "cline" ? null : selected.reduce((sum, row) =>
      sum + row.manifestReads.filter(read => read.input.range).length, 0),
    scopedManifestSearches: arm === "cline" ? null : selected.reduce((sum, row) => sum + row.manifestSearches.length, 0),
    explicitlyBracedAcceptedBodies: arm === "cline" ? null : selected.reduce((sum, row) =>
      sum + row.bodyEdits.filter(edit => edit.accepted && edit.explicitlyBraced).length, 0),
    unbracedAcceptedBodies: arm === "cline" ? null : selected.reduce((sum, row) =>
      sum + row.bodyEdits.filter(edit => edit.accepted && !edit.explicitlyBraced).length, 0),
  }];
}));
await writeFile(join(directory, "navigation-mechanism.json"), JSON.stringify({
  resultsSha256: createHash("sha256").update(source).digest("hex"),
  method: "Every retained finished tool input/output. Exposure/category bytes are descriptive, not billed savings. Native API uses different operations, so unavailable analogous measurements remain null. Braced edits/patches alone do not prove description causation.",
  summaries, rows }, null, 2) + "\n");
process.stdout.write(JSON.stringify(summaries) + "\n");
