// Post-outcome local mechanism diagnosis. Copies source into private controls;
// never modifies original model workspaces or returns information to a model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repo, work, studyFor } from "./campaign-paths.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT, "declarations-eur1");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const protocol = await json(join(studyFor("f24"), "protocol.json"));
const campaign = join(work, "f24"), analysis = await json(join(campaign, "analysis.json"));
const ledger = await json(join(campaign, "tool-ledger.json"));
assert.equal(analysis.rows.filter(r => r.arm !== "cline").length, protocol.tasks.length * protocol.repetitions * 2,
  "Wait for every Light assignment before diagnosing query exposure");
const queryCases = [];
for (const row of analysis.rows.filter(r => r.arm !== "cline")) {
  let renamed = false;
  for (const [index, t] of ledger.find(t => t.name === row.name).tools.entries()) {
    if (t.tool === "edit_code" && t.output?.status === "ok" && t.output?.data?.changed) renamed = true;
    if (t.tool === "search_code" && t.output?.status === "ok" && ["auto", "symbol"].includes(t.output.data?.mode))
      queryCases.push({ name: row.name, id: row.id, index, input: t.input, stage: renamed ? "final" : "original" });
  }
}
const root = join(work, "ranking-query-controls"); await mkdir(root);
const runtime = {};
for (const arm of ["baseline", "modified"]) runtime[arm] = (await import(pathToFileURL(
  join(work, "frozen/f24", arm, "agent-runtime/dist/harness/light-workspace.js")))).LightWorkspace;
const controls = new Map(), results = [];
for (const query of queryCases) {
  const key = query.id + "-" + query.stage;
  if (!controls.has(key)) {
    const target = join(root, key);
    execFileSync(process.execPath, [join(repo, "tools/terminal_bench/navigation-evidence/run.mjs"), "prepare", "f24", target, query.id], { cwd: repo });
    if (query.stage === "final") {
      const task = protocol.tasks.find(t => t.id === query.id), row = analysis.rows.find(r => r.id === query.id && r.independentFunctionalSuccess);
      assert(row, "A final-stage replay requires a scored source endpoint");
      for (const path of task.allowedPaths) await writeFile(join(target, path), await readFile(join(campaign, row.name, "workspace", path)));
    }
    controls.set(key, target);
  }
  const responses = {};
  for (const arm of ["baseline", "modified"]) {
    const workspace = new runtime[arm](controls.get(key), { sessionId: `${queryCases.indexOf(query)}-${arm}` });
    responses[arm] = await workspace.searchCode(query.input);
  }
  results.push({ ...query, responses, equalResponses: JSON.stringify(responses.baseline) === JSON.stringify(responses.modified) });
}
const output = { method: "Post-result zero-model diagnostic of every actually successful auto/symbol query. Initial input tree or independent copy of final scored sources chosen by source-edit chronology. Fresh alias session per query/arm, shared private source roots; compare complete returned JSON. Never alters original model sources/journals or feedback. Adoption alone does not establish a changed observation.",
  paidRequests: 0, eligibleQueries: results.length, changedResponses: results.filter(r => !r.equalResponses).length, rows: results };
await writeFile(join(studyFor("f24"), "ranking-query-replay.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ eligibleQueries: output.eligibleQueries, changedResponses: output.changedResponses, paidRequests: 0 }));
