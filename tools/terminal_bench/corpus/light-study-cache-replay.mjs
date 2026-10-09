import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const campaign = resolve(process.argv[2]);
const analysis = JSON.parse(await readFile(join(campaign, "analysis.json"), "utf8"));
const rows = [];
for (const trial of analysis.rows.filter((row) => row.id === "async-cache")) {
  const source = await readFile(join(campaign, trial.name, "workspace/src/project-cache.ts"), "utf8");
  const exports = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports }, { timeout: 1000 });
  let rejectOld, resolveNew, thirdCalls = 0;
  const old = exports.getCachedProject("same", () => new Promise((_, reject) => { rejectOld = reject; }))
    .then(() => "resolved", () => "rejected");
  await new Promise(setImmediate);
  exports.clearProjectCache();
  const current = exports.getCachedProject("same", () => new Promise((resolve) => { resolveNew = resolve; }));
  await new Promise(setImmediate);
  rejectOld(new Error("old generation failed"));
  await old;
  const third = exports.getCachedProject("same", async () => { thirdCalls++; return { id: "same", title: "Duplicate" }; });
  await new Promise(setImmediate);
  const concurrentDuplicateLoads = thirdCalls;
  const expected = { id: "same", title: "New" };
  resolveNew(expected);
  const [currentResult, duplicateResult] = await Promise.all([current, third]);
  rows.push({ name: trial.name, sourceSha256: createHash("sha256").update(source).digest("hex"),
    concurrentDuplicateLoads, sameValue: currentResult === duplicateResult,
    passed: concurrentDuplicateLoads === 0 && currentResult === duplicateResult });
}
const result = { selection: "Prospective supplemental audit: old-rejection interleaving selected from the known webhook diagnosis before any async-cache model trial. Applied uniformly; original scorer unchanged and no solution repair.",
  criterion: "After clear, rejection of an older load must not release the current pending load's reservation and permit duplicate concurrent loading.", rows };
await writeFile(join(campaign, "cache-replay.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
