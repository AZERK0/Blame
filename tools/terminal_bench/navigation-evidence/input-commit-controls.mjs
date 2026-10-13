// Zero-model control of registration time versus task-source commit identity.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { repo } from "./campaign-paths.mjs";
const parentStudy = join(repo, "docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-rename-ablation");
const tailStudy = join(repo, "docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-rename-tail");
const parent = JSON.parse(await readFile(join(parentStudy, "protocol.json")));
const tail = JSON.parse(await readFile(join(tailStudy, "protocol.json")));
const task = parent.tasks.find(t => t.id === tail.tasks[0].id);
const controls = [
  { name: "original-default", registeredAtUTC: parent.registeredAtUTC },
  { name: "later-pinned", registeredAtUTC: tail.registeredAtUTC, taskInputCommitAtUTC: parent.registeredAtUTC },
  { name: "later-unpinned", registeredAtUTC: tail.registeredAtUTC },
];
const output = join(repo, "docs/experiments/light-harness-input-commit-controls-2026-10-13");
const work = join(repo, ".blame/research/input-commit-controls"); await mkdir(work);
const rows = [];
for (const control of controls) {
  const variant = "input-clock-" + control.name;
  const study = join(repo, `docs/experiments/light-harness-navigation-evidence-f25-2026-10-13-${variant}`);
  await mkdir(study); // New, owned temporary registration; never overwrite.
  try {
    const protocol = { localControlOnly: true, ...control, upstreams: parent.upstreams,
      tasks: [{ id: task.id, project: task.project, inputFiles: task.inputFiles }] };
    await writeFile(join(study, "protocol.json"), JSON.stringify(protocol, null, 2) + "\n");
    const root = join(work, control.name);
    execFileSync(process.execPath, [join(repo, "tools/terminal_bench/navigation-evidence/run.mjs"), "prepare", "f25", root, task.id],
      { cwd: repo, env: { ...process.env, BLAME_STUDY_VARIANT: variant }, timeout: 30000 });
    const git = args => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    rows.push({ ...control, commit: git(["rev-parse", "HEAD"]), tree: git(["rev-parse", "HEAD^{tree}"]),
      commitMetadata: git(["cat-file", "-p", "HEAD"]), paidRequests: 0 });
  } finally { await rm(study, { recursive: true }); }
}
assert.equal(rows[0].commit, rows[1].commit, "Explicit input time decouples registration from git HEAD");
assert.notEqual(rows[0].commit, rows[2].commit, "Unpinned registration changes the actual prompt metadata");
assert(rows.every(r => r.tree === rows[0].tree), "All initial tracked source bytes and modes stay identical");
await mkdir(output);
await writeFile(join(output, "results.json"), JSON.stringify({ paidRequests: 0, rows,
  driverSha256: createHash("sha256").update(await readFile(join(repo, "tools/terminal_bench/navigation-evidence/run.mjs"))).digest("hex"),
  method: "Three actual prepare calls on identical pinned date-fns/task-fixture input. Default remains backward-compatible; an explicit taskInputCommitAtUTC retains the source commit across independent registration timestamps. Raw source trees are equal. Historical paid tail remains uncorrected and exploratory; this control establishes no cache or model-resource gain." }, null, 2) + "\n");
console.log(JSON.stringify({ paidRequests: 0, controls: rows.length, identicalSourceTrees: true,
  originalDefaultEqualsLaterPinned: true, unpinnedLaterDiffers: true }));
