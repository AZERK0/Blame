// Reconcile retained raw observations, controls and the actual admission stop.
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { join, resolve } from "node:path";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const local = join(repo, "docs/experiments/light-harness-declaration-navigation-local-2026-10-13");
const study = join(repo, "docs/experiments/light-harness-navigation-evidence-f24-2026-10-13-declarations");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const compressed = async path => JSON.parse(gunzipSync(await readFile(path)));
const retained = await compressed(join(local, "retained/replay.json.gz"));
const global = await compressed(join(local, "replay.json.gz"));
const saturation = await compressed(join(local, "retained/latency-regression-replay.json.gz"));
const adverse = await compressed(join(local, "latency-regression-replay.json.gz"));
const rows = retained.rows;
assert.equal(rows.length, 234); assert.equal(global.rows.length, 234);
assert.equal(saturation.rows.length, 6); assert.equal(adverse.rows.length, 6);
const summary = { paidRequests: 0, localObservations: 480, recall: [] };
for (const mode of ["symbol", "auto"]) for (const arm of ["baseline", "modified"]) {
  const count = [];
  for (let repetition = 1; repetition <= 3; repetition++) {
    const group = rows.filter(r => r.mode === mode && r.arm === arm && r.repetition === repetition && r.project === "lodash");
    assert.equal(group.length, 12);
    count.push({ present: group.filter(r => r.exactPresent).length, first: group.filter(r => r.exactFirst).length });
  }
  assert(count.every(value => value.present === (arm === "baseline" ? 7 : 11) && value.first === (arm === "baseline" ? 4 : 11)));
  summary.recall.push({ mode, arm, uniqueQueries: 12, repetitions: 3, ...count[0] });
}
let textPairs = 0;
for (const row of rows.filter(r => r.mode === "text" && r.arm === "baseline")) {
  const paired = rows.find(r => r.arm === "modified" && r.query === row.query && r.mode === row.mode && r.repetition === row.repetition);
  assert.deepEqual(row.response, paired.response); textPairs++;
}
assert.equal(textPairs, 36);
const bodyReads = rows.filter(r => r.exactRead);
assert.equal(bodyReads.length, 114); assert(bodyReads.every(r => r.exactRead.status === "ok" && r.exactRead.sourceUnchanged));
assert(saturation.rows.every(r => r.filesystemReadCount === 65));
assert(adverse.rows.every(r => r.filesystemReadCount === (r.arm === "baseline" ? 65 : 1479)));
const controls = await compressed(join(study, "local-controls.json.gz"));
assert.equal(controls.controls.length, 2); assert.equal(controls.replays.length, 4);
assert(controls.controls.every(c => c.originalRejected && c.oracleAccepted && c.lexicalHomonymRejected && c.missingConsumerRejected &&
  c.types.code === 0 && c.selected.code === 0 && c.full.code === 0 && /3140 passed \| 18 skipped \(3158\)/u.test(c.full.stdout)));
assert(controls.replays.every(r => r.auditedMigration && r.sourceMatchesValidatedControl && r.unexpectedPaths.length === 0));
const outcomes = await json(join(study, "assigned-outcomes.json")), budget = await json(join(study, "budget-preflight.json"));
assert.equal(outcomes.planned, 18); assert.equal(outcomes.attempted, 0);
assert(outcomes.rows.every(r => r.status === "not-run-budget" && r.officialSuccess === null && r.auditedSuccess === null && r.estimatedCostUsd === null));
assert.equal(budget.admitted, false); assert.equal(budget.priorObservedOrReservedUsd, .408056);
assert(budget.priorObservedOrReservedUsd + budget.nextAdmissionReserveUsd > budget.ceilingUsd);
Object.assign(summary, { unchangedTextPairs: textPairs, successfulBodyReads: bodyReads.length,
  graderControls: 8, staticMigrationReplays: 4, plannedModelTrials: 18, attemptedModelTrials: 0,
  budgetAdmission: false, pdfCompilation: "unverified: built-in app tools unavailable on this host" });
await writeFile(join(local, "audit.json"), JSON.stringify(summary, null, 2) + "\n");
// Inventory all saved study artifacts after reconciliation, excluding inventories.
for (const root of [local, study]) {
  const files = (await readdir(root, { recursive: true, withFileTypes: true })).filter(e => e.isFile() && e.name !== "inventory.json")
    .map(e => join(e.parentPath ?? e.path, e.name)).sort();
  const inventory = [];
  for (const path of files) {
    const bytes = await readFile(path); inventory.push({ path: path.slice(root.length + 1), bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await writeFile(join(root, "inventory.json"), JSON.stringify({ artifacts: inventory }, null, 2) + "\n");
}
console.log(JSON.stringify(summary));
