// Supervisor-only differential controls. No model, no source recovery, no paid call.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { repo, work, studyFor } from "./campaign-paths.mjs";
import { normalizedHeader, expectedInventory } from "./inventory-criteria.mjs";

assert.equal(process.env.BLAME_STUDY_VARIANT, "confirm2");
const json = async path => JSON.parse(await readFile(path, "utf8"));
const sha = data => createHash("sha256").update(data).digest("hex");
const records = [];
for (const panel of ["f21", "f22", "f23"]) {
  const protocol = await json(join(studyFor(panel), "protocol.json"));
  for (const arm of ["baseline", "modified"]) {
    const { lightReadCodeInputSchema } = await import(pathToFileURL(join(work, "frozen", panel, arm,
      "agent-runtime/dist/harness/light-contracts.js")));
    const { LightWorkspace } = await import(pathToFileURL(join(work, "frozen", panel, arm,
      "agent-runtime/dist/harness/light-workspace.js")));
    for (const task of protocol.tasks) {
      const directory = join(work, "mechanism-controls", panel, arm, task.id);
      execFileSync(process.execPath, ["tools/terminal_bench/navigation-evidence/run.mjs", "prepare", panel,
        directory, task.id], { cwd: repo });
      if (panel === "f23") {
        const file = join(directory, "lodash.js"), source = await readFile(file, "utf8");
        assert.equal(source.split(task.seed.after).length, 2);
        await writeFile(file, source.replace(task.seed.after, task.seed.before));
      }
      const workspace = new LightWorkspace(directory, { sessionId: "differential-" + panel + "-" + arm });
      if (panel === "f21") {
        const before = await readFile(join(directory, "lodash.js"));
        const read = await workspace.readCode({ target: "lodash.js#" + task.oldName }, {});
        assert.equal(read.status, "ok");
        const other = task.oldName === "baseIsNaN" ? "baseInRange(number, start, end)" : "baseIsNaN(value)";
        const output = await workspace.editCode({ operations: [{ kind: "patch", target: read.data.alias,
          patch: "*** Begin Patch\n*** Update File: lodash.js\n@@\n-    function " + other + " {\n+    function outsideTarget() {\n*** End Patch" }] }, {});
        assert.equal(output.status, "blocked");
        assert.deepEqual(await readFile(join(directory, "lodash.js")), before);
        const hint = output.recovery?.includes('"nextRead"') ?? false;
        assert.equal(hint, arm === "modified");
        records.push({ panel, arm, id: task.id, atomicRejection: true, boundedHint: hint,
          returnedBytes: Buffer.byteLength(JSON.stringify(output)), unchangedSourceSha256: sha(before) });
      } else if (panel === "f22") {
        const expected = await expectedInventory(directory, task.targets);
        for (let index = 0; index < task.targets.length; index++) {
          const target = task.targets[index], output = await workspace.readCode({
            target: target.path + "#" + target.name, view: "signature" }, {});
          if (arm === "modified") {
            assert.equal(output.status, "ok", JSON.stringify(output));
            assert.equal(output.data.bodyOmitted, true);
            assert.equal(normalizedHeader(output.data.signature.replace(/\{\s*$/u, "")),
              normalizedHeader(expected.functions[index].signature));
          } else {
            assert.equal(lightReadCodeInputSchema.safeParse({target:target.path+"#"+target.name,view:"signature"}).success,false);
            // Direct typed workspace methods assume validated input; bypassing
            // the public schema falls back to the normal complete symbol read.
            assert.notEqual(output.data?.view,"signature");
          }
          records.push({ panel, arm, id: task.id, target, signatureAvailable: output.data?.view === "signature",
            returnedBytes: Buffer.byteLength(JSON.stringify(output)), bodyOmitted: output.data?.bodyOmitted ?? null });
        }
      } else {
        const result = await workspace.runTask({ kind: "project", task: "test:confirmation",
          args: task.requiredChecks[0].args }, {});
        assert.equal(result.status, "ok", JSON.stringify(result));
        const { check, output } = result.data;
        assert.equal(check.evidenceOrigin, "node_events");
        assert.equal(check.counts.passed, task.expectedActiveCounts.passed);
        assert.equal(check.counts.failed, task.expectedActiveCounts.failed);
        assert.equal(check.counts.skipped, task.expectedActiveCounts.skippedOrTodo);
        const caption = output.includes("Active Node case results:");
        assert.equal(caption, arm === "modified");
        assert.equal(check.selection, "unknown");
        assert.equal(check.freshness, "unknown");
        records.push({ panel, arm, id: task.id, counts: check.counts, caption,
          reportSha256: check.evidence.reportSha256, genericAdmission: result.data.validation.status });
      }
    }
  }
}
await writeFile(join(repo, "docs/experiments/light-harness-mechanism-confirmation-2026-10-13/mechanism-controls.json"),
  JSON.stringify({ method: "New-task, supervisor-only differential controls. Same guards and event proof; only studied feature differs. Not model confirmation rows.", records, paidRequests: 0 }, null, 2) + "\n");
console.log(JSON.stringify({ assertionsPassed: records.length, paidRequests: 0 }));
