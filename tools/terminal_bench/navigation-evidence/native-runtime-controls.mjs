// Private mechanism checks before model dispatch, never oracle feedback.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { repo, work, studyFor } from "./campaign-paths.mjs";
import { applyOracle, auditMultifile } from "./multifile-criteria.mjs";
assert.equal(process.env.BLAME_STUDY_VARIANT, "native2");
const study = studyFor("f27"), protocol = JSON.parse(await readFile(join(study, "protocol.json")));
const originalFor = task => join(repo, protocol.upstreams[task.project].sourceRoot);
if (process.argv[2] === "worker") {
  const [arm, root, taskId] = process.argv.slice(3), task = protocol.tasks.find(t => t.id === taskId);
  const { LightWorkspace } = await import(pathToFileURL(join(work, "frozen/f27", arm, "agent-runtime/dist/harness/light-workspace.js")));
  const workspace = new LightWorkspace(root, { sessionId: "local-ablation-control" });
  const searches = [];
  for (const input of [{ query: task.oldName, mode: "symbol", scope: task.declarationPath },
    { query: `${task.declarationPath}#${task.oldName}`, mode: "references" }]) searches.push(await workspace.searchCode(input));
  const before = Object.fromEntries(await Promise.all(task.allowedPaths.map(async path => [path, await readFile(join(root, path), "utf8")])));
  for (const path of task.allowedPaths) assert.equal((await workspace.readCode({ target: path, view: "raw" }, {})).status, "ok");
  const start = performance.now();
  const rename = await workspace.editCode({ operations: [{ kind: "symbol", target: `${task.declarationPath}#${task.oldName}`, action: "rename", content: task.newName }] });
  const renameMs = performance.now() - start;
  let fallbackPatch = null;
  if (arm === "baseline") {
    assert.equal(rename.status, "blocked"); assert.match(rename.message, /Compiler rename is disabled/u);
    for (const path of task.allowedPaths) assert.equal(await readFile(join(root, path), "utf8"), before[path]);
    // Entire-file private oracle patches test fallback feasibility only. They are
    // not scored model outputs and never become a model's task input or context.
    const operations = task.allowedPaths.map(path => {
      const expected = applyOracle(before[path], task.oracle.spans[path] ?? [], task.newName);
      const lines = text => text.trimEnd().split("\n");
      return { kind: "patch", path, patch: ["*** Begin Patch", `*** Update File: ${path}`, "@@",
        ...lines(before[path]).map(l => "-" + l), ...lines(expected).map(l => "+" + l), "*** End Patch"].join("\n") };
    });
    fallbackPatch = await workspace.editCode({ operations }); assert.equal(fallbackPatch.status, "ok", JSON.stringify(fallbackPatch));
  } else assert.equal(rename.status, "ok", JSON.stringify(rename));
  const criteria = await auditMultifile(originalFor(task), root, task); assert(criteria.every(c => c.passed));
  const sourcesMatchOracle = (await Promise.all(task.allowedPaths.map(async path =>
    await readFile(join(root, path), "utf8") === applyOracle(before[path], task.oracle.spans[path] ?? [], task.newName)))).every(Boolean);
  assert(sourcesMatchOracle);
  process.stdout.write(JSON.stringify({ arm, id: taskId, searches, rename, renameMs, fallbackPatch, criteria,
    sourcesMatchOracle, disabledActionWrites: arm === "baseline" ? 0 : null }));
} else {
  const directory = join(work, "local-controls-scoped"); await mkdir(directory);
  const rows = [];
  for (const task of protocol.tasks.filter(t=>t.kind==="multifile-rename")) for (const arm of ["baseline", "modified"]) {
    const root = join(directory, task.id + "-" + arm);
    execFileSync(process.execPath, [join(repo, "tools/terminal_bench/navigation-evidence/run.mjs"), "prepare", "f27", root, task.id], { cwd: repo });
    rows.push(JSON.parse(execFileSync(process.execPath, [new URL(import.meta.url).pathname, "worker", arm, root, task.id],
      { cwd: repo, timeout: 120000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" })));
  }
  for (const task of protocol.tasks.filter(t=>t.kind==="multifile-rename")) {
    const a = rows.find(r => r.id === task.id && r.arm === "baseline"), b = rows.find(r => r.id === task.id && r.arm === "modified");
    assert.deepEqual(a.searches[0], b.searches[0], "Declaration navigation unchanged");
    assert.match(JSON.stringify(a.searches[1]), /typescript_language_service/u);
    assert.match(JSON.stringify(b.searches[1]), /typescript_language_service/u);
    for (const path of task.allowedPaths) assert.deepEqual(await readFile(join(directory, task.id + "-baseline", path)),
      await readFile(join(directory, task.id + "-modified", path)));
  }
  const output = { paidRequests: 0, rows, mechanism: "Both disabled renames block without writes; explicit observed patches remain feasible and produce byte-identical compiler-renamed endpoints. Declaration responses match, compiler references remain active. No model benefit is inferred.",
    validation: "Endpoints byte-match the privately validated F27 oracle positives; this control does not rerun the full suite or admit harness verification. Paid final outputs are independently checked again." };
  await writeFile(join(study, "local-controls.json"), JSON.stringify(output, null, 2) + "\n");
  console.log(JSON.stringify({ paidRequests: 0, controls: rows.length, allSourcesMatch: rows.every(r => r.sourcesMatchOracle) }));
}
