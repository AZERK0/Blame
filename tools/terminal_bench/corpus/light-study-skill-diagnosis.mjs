import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { gunzipSync } from "node:zlib";

const source = resolve(process.argv[2]);
const destination = resolve(process.argv[3]);
const raw = await readFile(join(source, "results.json"));
const results = JSON.parse(raw);
const ledger = JSON.parse(await readFile(join(source, "tool-ledger.json"), "utf8"));
const completed = (row) => row.auditedSuccess && row.status === "succeeded";
const pairs = results.rows.filter((row) => row.arm === "modified" && completed(row) &&
  results.rows.some((other) => other.arm === "cline" && other.id === row.id &&
    other.repetition === row.repetition && other.condition === row.condition && completed(other)));
const summaries = {};
for (const arm of ["modified", "cline"]) {
  const summary = { trials: pairs.length, input: 0, output: 0, modelRequests: 0,
    toolCalls: 0, composedBytes: 0, messageBytes: 0, categories: {},
    compositionInstrumented: arm !== "cline" };
  for (const pair of pairs) {
    const row = results.rows.find((other) => other.arm === arm && other.id === pair.id &&
      other.repetition === pair.repetition && other.condition === pair.condition);
    const execution = JSON.parse(gunzipSync(await readFile(join(source, "traces", `${row.name}.result.json.gz`))));
    summary.input += row.usage.input;
    summary.output += row.usage.output;
    summary.modelRequests += execution.metrics.context.modelRequests;
    summary.toolCalls += execution.metrics.tools.calls;
    const composition = execution.metrics.context.composition;
    summary.composedBytes += composition.composedBytes;
    summary.messageBytes += composition.messageBytes;
    for (const [key, bytes] of Object.entries(composition.categoryBytes))
      summary.categories[key] = (summary.categories[key] ?? 0) + bytes;
  }
  if (!summary.compositionInstrumented) {
    summary.composedBytes = null; summary.messageBytes = null; summary.categories = null;
  }
  summaries[arm] = summary;
}
const skillTrials = results.rows.filter((row) => row.arm !== "cline").map((row) => ({
  name: row.name,
  invocations: ledger.find((trial) => trial.name === row.name).tools
    .filter((tool) => tool.tool === "skills").map((tool) => tool.input.skill),
}));
const diagnosis = { analyzedAt: new Date().toISOString(),
  sourceResultsSha256: createHash("sha256").update(raw).digest("hex"),
  selection: "Known prior ordinary campaign used to select the skill-scope information hypothesis, not new confirmation evidence.",
  method: "Task/repetition-matched independently audited AND runtime-completed pairs, without solution repair. Category bytes are repeated provider context exposure, not billed tokens; native composition categories were not instrumented.",
  summaries, skillTrials,
  loadedLightTrials: skillTrials.filter((trial) => trial.invocations.length).length,
  totalLightTrials: skillTrials.length };
await writeFile(destination, JSON.stringify(diagnosis, null, 2) + "\n");
console.log(JSON.stringify({ matched: pairs.length, loadedLightTrials: diagnosis.loadedLightTrials,
  totalLightTrials: diagnosis.totalLightTrials, summaries }));
