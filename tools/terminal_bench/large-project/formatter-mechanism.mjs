// Descriptive recorded routing; never infer formatter or task success from wording.
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const directory = resolve(process.argv[2]);
const bytes = await readFile(join(directory, "results.json"));
const results = JSON.parse(bytes);
const rows = [];
for (const row of results.rows) {
  const raw = gunzipSync(await readFile(join(directory, "traces", row.name + ".events.jsonl.gz")));
  const tools = raw.toString().split("\n").filter(Boolean).map(line => JSON.parse(line).event)
    .filter(event => event?.type === "tool" && event.payload.phase === "finished")
    .map(event => ({ tool: event.payload.toolCall?.name ?? event.payload.tool,
      input: event.payload.toolCall?.input ?? event.payload.input,
      output: event.payload.output ?? event.payload.result }));
  const requests = tools.map((tool, index) => ({ ...tool, index }))
    .filter(tool => tool.tool === "run_task" && tool.input.kind === "command" &&
      /\bprettier\b/u.test(tool.input.command))
    .map(tool => ({ index: tool.index, input: tool.input, output: tool.output,
      atomicFormatterApplied: tool.output?.status === "ok" &&
        tool.output?.data?.mutation === "deterministic_format",
      explicitNoInstallNpm: /^(?:npx --no-install prettier|npm exec --no -- prettier)\s/u.test(tool.input.command),
      newRecoveryExposed: tool.output?.status === "blocked" &&
        /npx --no-install prettier/u.test(tool.output?.message ?? ""),
      blocked: tool.output?.status === "blocked",
      blankDiagnostic: tool.output?.status === "blocked" && !(tool.output?.message ?? "").trim(),
    }));
  const nativeCommands = tools.map((tool, index) => ({ ...tool, index }))
    .filter(tool => tool.tool === "run_commands")
    .flatMap(tool => (tool.input.commands ?? [])
      .filter(command => /\bprettier\b/u.test(command))
      .map(command => ({ index: tool.index, command, output: tool.output })));
  rows.push({ name: row.name, arm: row.arm,
    eventsSha256: createHash("sha256").update(raw).digest("hex"),
    requests: row.arm === "cline" ? null : requests,
    nativeCommands: row.arm === "cline" ? nativeCommands : null });
}
const summaries = Object.fromEntries(["baseline", "modified", "cline"].map(arm => {
  const selected = rows.filter(row => row.arm === arm);
  const requests = selected.flatMap(row => row.requests ?? []);
  const count = key => arm === "cline" ? null : requests.filter(request => request[key]).length;
  return [arm, { trials: selected.length,
    recordedPrettierRequests: arm === "cline" ? null : requests.length,
    atomicFormatterApplied: count("atomicFormatterApplied"),
    explicitNoInstallNpm: count("explicitNoInstallNpm"),
    noInstallNpmApplied: arm === "cline" ? null : requests.filter(request =>
      request.explicitNoInstallNpm && request.atomicFormatterApplied).length,
    newRecoveryExposed: count("newRecoveryExposed"), blocked: count("blocked"),
    blankDiagnostic: count("blankDiagnostic"),
    nativeCommandsMentioningPrettier: arm === "cline"
      ? selected.reduce((sum, row) => sum + row.nativeCommands.length, 0) : null }];
}));
await writeFile(join(directory, "formatter-mechanism.json"), JSON.stringify({
  method: "All finished effective tool inputs/outputs. Applied means the runtime explicitly reports deterministic_format; blocked requests and blank diagnostics remain. Native shell commands are recorded separately and do not imply equivalent atomic effects. Counts are descriptive, not causal model success or resource savings.",
  resultsSha256: createHash("sha256").update(bytes).digest("hex"), summaries, rows }, null, 2) + "\n");
process.stdout.write(JSON.stringify(summaries) + "\n");
