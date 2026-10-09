import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const campaign = resolve(process.argv[2] ?? ".blame/research/pilot");
const destination = resolve(
  process.argv[3] ?? "docs/experiments/light-harness-2026-10-09",
);
const analysis = JSON.parse(
  await readFile(join(campaign, "analysis.json"), "utf8"),
);
const adjudication = JSON.parse(
  await readFile(join(campaign, "adjudication.json"), "utf8"),
);
if (analysis.completed !== analysis.planned)
  throw new Error("Retain all planned trials before publication");
for (const row of analysis.rows) {
  const name = row.name ?? `${row.repetition}-${row.id}-${row.arm}`;
  const decision = adjudication.decisions.find((x) => x.name === name);
  if (!decision || decision.review !== "reviewed")
    throw new Error(`Unreviewed ${name}`);
  row.auditedSuccess = decision.independentSuccess;
  row.officialSuccess = row.qualityScore === 100;
}
const summary = {
  definition:
    "Original functional scorer, audited instruction obligations, runtime termination and admitted verification are separate. Missing request/cache usage remains missing; totals with unreconciled trials are observed lower bounds.",
  arms: {},
};
for (const arm of ["baseline", "modified", "cline"]) {
  const rows = analysis.rows.filter((r) => r.arm === arm);
  summary.arms[arm] = {
    trials: rows.length,
    functionalSuccess: rows.filter((r) => r.functionalSuccess).length,
    officialSuccess: rows.filter((r) => r.officialSuccess).length,
    auditedSuccess: rows.filter((r) => r.auditedSuccess).length,
    runtimeSucceeded: rows.filter((r) => r.status === "succeeded").length,
    runtimeFailed: rows.filter((r) => r.status === "failed").length,
    runtimeTimedOut: rows.filter((r) => r.status === "timed_out").length,
    tokensCostReconciled: rows.filter((r) => r.usage.tokensCostReconciled)
      .length,
    allUsageReconciled: rows.filter((r) => r.usage.complete).length,
    argsUsed: rows.reduce((s, r) => s + r.argsUsed, 0),
    taskSelectionRefusals: rows.reduce(
      (s, r) => s + r.taskSelectionRefusals,
      0,
    ),
    summedRunnerSeconds:
      rows.reduce((s, r) => s + (r.durationMs ?? 0), 0) / 1000,
    preparationSeconds: rows.reduce((s, r) => s + r.preparationMs, 0) / 1000,
    verificationSeconds: rows.reduce((s, r) => s + r.verificationMs, 0) / 1000,
    outerAgentSeconds: rows.reduce((s, r) => s + r.outerAgentMs, 0) / 1000,
    partitions: Object.fromEntries(
      ["diagnostic", "confirmation"].map((partition) => [
        partition,
        {
          trials: rows.filter((r) => r.partition === partition).length,
          auditedSuccess: rows.filter(
            (r) => r.partition === partition && r.auditedSuccess,
          ).length,
          officialSuccess: rows.filter(
            (r) => r.partition === partition && r.officialSuccess,
          ).length,
          functionalSuccess: rows.filter(
            (r) => r.partition === partition && r.functionalSuccess,
          ).length,
          tokensCostReconciled: rows.filter(
            (r) => r.partition === partition && r.usage.tokensCostReconciled,
          ).length,
          summedRunnerSeconds:
            rows
              .filter((r) => r.partition === partition)
              .reduce((sum, r) => sum + (r.durationMs ?? 0), 0) / 1000,
          outerAgentSeconds:
            rows
              .filter((r) => r.partition === partition)
              .reduce((sum, r) => sum + r.outerAgentMs, 0) / 1000,
        },
      ]),
    ),
    ...(rows.some((row) => row.condition)
      ? {
          conditions: Object.fromEntries(
            ["clean", "interrupted"].map((condition) => [
              condition,
              {
                ...conditionResources(
                  rows.filter((r) => r.condition === condition),
                ),
                trials: rows.filter((r) => r.condition === condition).length,
                auditedSuccess: rows.filter(
                  (r) => r.condition === condition && r.auditedSuccess,
                ).length,
                runtimeSucceeded: rows.filter(
                  (r) => r.condition === condition && r.status === "succeeded",
                ).length,
                faultActivated: rows.filter(
                  (r) =>
                    r.condition === condition &&
                    r.faultEvents?.some((event) => event.injected),
                ).length,
                recoveryActivated: rows.filter(
                  (r) => r.condition === condition && r.recoveryNotices > 0,
                ).length,
              },
            ]),
          ),
        }
      : {}),
  };
  const data = summary.arms[arm];
  for (const field of ["input", "output", "cacheRead", "cacheWrite", "cost"]) {
    data[field] = usageTotal(rows, field);
    for (const [condition, stats] of Object.entries(data.conditions ?? {}))
      stats[field] = usageTotal(
        rows.filter((r) => r.condition === condition),
        field,
      );
  }
}
await mkdir(join(destination, "traces"), { recursive: true });
const inventory = [];
for (const row of analysis.rows) {
  const name = row.name ?? `${row.repetition}-${row.id}-${row.arm}`;
  for (const filename of [
    "events.jsonl",
    "workspace.diff",
    "result.json",
    "instruction.txt",
    ...(row.condition === "interrupted" ? ["fault.jsonl"] : []),
  ]) {
    let raw;
    try {
      raw = await readFile(join(campaign, name, filename));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      inventory.push({ artifact: `${name}.${filename}`, missing: true });
      continue;
    }
    // Inspect/redact before publication; never print credentials or replace missing observations.
    const token = process.env.BLAME_API_TOKEN;
    if (token && raw.includes(Buffer.from(token)))
      throw new Error(`Credential found in ${name}/${filename}`);
    const artifact = `${name}.${filename}.gz`;
    await writeFile(join(destination, "traces", artifact), gzipSync(raw));
    inventory.push({
      artifact,
      sha256: createHash("sha256").update(raw).digest("hex"),
      uncompressedBytes: raw.length,
    });
  }
}
const ledger = JSON.parse(
  await readFile(join(campaign, "tool-ledger.json"), "utf8"),
);
const reviewLedger = ledger.map((trial) => ({
  name: trial.name,
  tools: trial.tools.map((t) => {
    const output = JSON.stringify(t.output);
    return {
      tool: t.tool,
      input: t.input,
      timestamp: t.timestamp,
      durationMs: t.durationMs ?? null,
      outputSha256: createHash("sha256")
        .update(output ?? "")
        .digest("hex"),
      outputExcerpt: output?.slice(0, 2000) ?? null,
    };
  }),
}));
const cleanAnalysis = {
  ...analysis,
  rows: analysis.rows.map(({ metrics, ...r }) => r),
};
for (const [name, value] of Object.entries({
  summary,
  results: cleanAnalysis,
  adjudication,
  inventory,
  "tool-ledger": reviewLedger,
}))
  await writeFile(
    join(destination, `${name}.json`),
    JSON.stringify(value, null, 2) + "\n",
  );
console.log(JSON.stringify(summary));

function usageTotal(rows, field) {
  return {
    observed: rows.reduce((s, r) => s + (r.usage[field] ?? 0), 0),
    missingAggregates: rows.filter((r) => r.usage[field] === null).length,
    incompleteTrialAccounting: rows.filter((r) => !r.usage.tokensCostReconciled)
      .length,
  };
}

function conditionResources(rows) {
  return {
    officialSuccess: rows.filter((row) => row.officialSuccess).length,
    functionalSuccess: rows.filter((row) => row.functionalSuccess).length,
    tokensCostReconciled: rows.filter((row) => row.usage.tokensCostReconciled)
      .length,
    allUsageReconciled: rows.filter((row) => row.usage.complete).length,
    summedRunnerSeconds:
      rows.reduce((sum, row) => sum + (row.durationMs ?? 0), 0) / 1000,
    outerAgentSeconds:
      rows.reduce((sum, row) => sum + row.outerAgentMs, 0) / 1000,
  };
}
