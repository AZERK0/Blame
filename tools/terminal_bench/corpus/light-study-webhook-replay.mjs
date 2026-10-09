import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const rows = [];
for (const trial of analysis.rows.filter((row) => row.id === "webhook-idempotency")) {
  const source = await readFile(join(campaign, trial.name, "workspace/src/webhook.ts"), "utf8");
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports });
  let rejectOld, resolveNew, thirdCalls = 0;
  const old = exports.processWebhook("same", () => new Promise((_, reject) => { rejectOld = reject; }))
    .then(() => "resolved", () => "rejected");
  await Promise.resolve();
  exports.clearProcessedWebhooks();
  const current = exports.processWebhook("same", () => new Promise((resolve) => { resolveNew = resolve; }));
  await Promise.resolve();
  rejectOld(new Error("old generation failed"));
  await old;
  // The new generation is still pending: the old rejection must not remove its reservation.
  const third = exports.processWebhook("same", async () => { thirdCalls++; });
  await Promise.resolve();
  const concurrentDuplicateCalls = thirdCalls;
  resolveNew();
  const [currentResult, duplicateResult] = await Promise.all([current, third]);
  rows.push({ name: trial.name, sourceSha256: createHash("sha256").update(source).digest("hex"),
    concurrentDuplicateCalls, currentResult, duplicateResult,
    passed: concurrentDuplicateCalls === 0 && currentResult === true && duplicateResult === false });
}
const result = { selection: "Exploratory: selected after inspecting first-repetition sources; applied uniformly to every webhook solution. Not a preregistered endpoint, no solution repair or scorer substitution.",
  criterion: "An old failing handler after clear must not release a newly pending handler's reservation for the same eventId.", rows };
await writeFile(join(campaign, "webhook-replay.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
