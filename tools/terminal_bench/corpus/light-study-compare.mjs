import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const directory = resolve(process.argv[2]);
const results = JSON.parse(await readFile(join(directory, "results.json"), "utf8"));
if (results.completed !== results.planned) throw new Error("Comparison requires all planned outcomes");
const comparisons = [];
for (const [left, right] of [["modified", "baseline"], ["modified", "cline"], ["baseline", "cline"]]) {
  for (const partition of ["all", "diagnostic", "confirmation"]) {
    const selected = results.rows.filter((row) => row.arm === left &&
      (partition === "all" || row.partition === partition));
    const pairs = selected.map((row) => [row, results.rows.find((other) =>
      other.arm === right && other.id === row.id && other.repetition === row.repetition &&
      other.condition === row.condition)]);
    if (pairs.some(([, other]) => !other)) throw new Error("Missing paired outcome");
    const bothSuccess = pairs.filter(([a, b]) => a.auditedSuccess && b.auditedSuccess);
    const reconciled = bothSuccess.filter(([a, b]) => a.usage.tokensCostReconciled && b.usage.tokensCostReconciled);
    comparisons.push({ left, right, partition, plannedPairs: pairs.length,
      leftAuditedSuccess: pairs.filter(([a]) => a.auditedSuccess).length,
      rightAuditedSuccess: pairs.filter(([, b]) => b.auditedSuccess).length,
      leftOnlySuccess: pairs.filter(([a, b]) => a.auditedSuccess && !b.auditedSuccess).length,
      rightOnlySuccess: pairs.filter(([a, b]) => !a.auditedSuccess && b.auditedSuccess).length,
      bothSuccessPairs: bothSuccess.length, reconciledBothSuccessPairs: reconciled.length,
      bothSuccessConditions: Object.fromEntries([...new Set(bothSuccess.map(([a]) => a.condition ?? "unspecified"))]
        .map((condition) => [condition, bothSuccess.filter(([a]) => (a.condition ?? "unspecified") === condition).length])),
      // Failed/unreconciled rows remain in results and full-panel resources; these are conditional cohorts.
      conditionalResourceRatios: {
        input: compare(reconciled, (row) => row.usage.input),
        output: compare(reconciled, (row) => row.usage.output),
        tokens: compare(reconciled, (row) => row.usage.input + row.usage.output),
        estimatedCost: compare(reconciled, (row) => row.usage.cost),
        runnerTime: compare(bothSuccess, (row) => row.durationMs),
        outerTime: compare(bothSuccess, (row) => row.outerAgentMs),
      } });
  }
}
const output = { resultsSha256: createHash("sha256").update(await readFile(join(directory, "results.json"))).digest("hex"),
  method: "Left/right summed resource ratio on prespecified task-matched, independently audited both-success pairs. Tokens/estimated cost additionally require reconciled observed usage. All failures and missing usage remain in full-panel results; conditional cohorts are not a population efficiency or quality equivalence certificate. Exploratory 95% percentile intervals resample task clusters (both repetitions together), 10000 draws, fixed seed 20261009; no model resampling.", comparisons };
await writeFile(join(directory, "paired-comparison.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify(output));

function compare(pairs, measure) {
  if (!pairs.length) return { pairs: 0, ratio: null, interval95: null };
  const clusters = new Map();
  for (const [a, b] of pairs) {
    const cluster = clusters.get(a.id) ?? [0, 0];
    cluster[0] += measure(a); cluster[1] += measure(b); clusters.set(a.id, cluster);
  }
  const values = [...clusters.values()];
  const [left, right] = values.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  let state = 20261009;
  const estimates = [];
  for (let draw = 0; draw < 10000; draw++) {
    let numerator = 0, denominator = 0;
    for (let i = 0; i < values.length; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const [a, b] = values[Math.floor(state / 4294967296 * values.length)];
      numerator += a; denominator += b;
    }
    if (denominator > 0) estimates.push(numerator / denominator);
  }
  estimates.sort((a, b) => a - b);
  return { pairs: pairs.length, taskClusters: values.length, left, right,
    ratio: right > 0 ? left / right : null,
    interval95: estimates.length ? [estimates[Math.floor(estimates.length * .025)], estimates[Math.min(estimates.length - 1, Math.floor(estimates.length * .975))]] : null };
}
