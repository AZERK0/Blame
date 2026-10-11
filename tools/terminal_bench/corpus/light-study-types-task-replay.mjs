import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const installed = resolve("packages/agent-runtime/node_modules");
const compiler = JSON.parse(await readFile(join(installed, "typescript/package.json"))).version;
const rows = [];
async function completed(workspace, request) {
  let result = await workspace.runTask(request, {});
  const deadline = Date.now() + 30000;
  while (result.status === "ok" && result.data?.process === "running") {
    assert.ok(Date.now() < deadline, "Compiler process did not settle");
    await new Promise(done => setTimeout(done, 25));
    result = await workspace.runTask({ kind: "inspect", run: result.data.run, cursor: result.data.cursor }, {});
  }
  return result;
}
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, "dist/harness/light-workspace.js")));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, "dist/harness/session-journal.js")));
  const { readTaskCatalog } = await import(pathToFileURL(join(runtime, "dist/harness/task-catalog.js")));
  const { executeLocalFinishTask } = await import(pathToFileURL(join(runtime, "dist/harness/light-finish-service.js")));
  for (const route of ["command", "project"]) for (const kind of ["pass", "fail", "stale"]) {
    const root = await mkdtemp(join(tmpdir(), "blame-types-task-"));
    try {
      const manifest = JSON.stringify({ scripts: { types: "tsc --noEmit" },
        devDependencies: { typescript: compiler }, packageManager: "npm" });
      await writeFile(join(root, "package.json"), manifest);
      await symlink(installed, join(root, "node_modules"));
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        strict: true, noEmit: true, types: [], target: "ES2022", skipLibCheck: true,
      }, include: ["value.ts"] }));
      await writeFile(join(root, "value.ts"), "export const value: number = 1;\n");
      const taskContract = {
        session_id: "types-task", objective: "apply requested change", effect_requirement: "source_change",
        acceptance_criteria: ["apply requested change"],
      };
      const workspace = new LightWorkspace(root, { sessionId: "types-task", taskContract });
      const journal = new SessionJournal(root, "types-task");
      const edit = async value => {
        await workspace.readCode({ target: "value.ts", view: "raw" }, {});
        const old = await readFile(join(root, "value.ts"), "utf8");
        const result = await workspace.editCode({ operations: [{ kind: "patch", path: "value.ts",
          patch: "*** Begin Patch\n*** Update File: value.ts\n@@\n-" + old.trimEnd() +
            "\n+export const value: number = " + value + ";\n*** End Patch" }] });
        assert.equal(result.status, "ok");
      };
      await edit(kind === "fail" ? '"broken"' : "2");
      const taskKind = (await readTaskCatalog(root)).find(task => task.script === "types").kind;
      const result = await completed(workspace, route === "project"
        ? { kind: "project", task: "types" }
        : { kind: "command", command: "npm run types" });
      const afterRun = await journal.completionSnapshot();
      if (kind === "stale") await edit('"broken"');
      const beforeFinish = await readFile(join(root, "value.ts"), "utf8");
      const finish = await executeLocalFinishTask({ workspaceRoot: root, taskContract, context: {},
        input: { summary: "Apply requested source change" } });
      const final = await journal.completionSnapshot();
      assert.equal(await readFile(join(root, "value.ts"), "utf8"), beforeFinish);
      assert.equal(await readFile(join(root, "package.json"), "utf8"), manifest);
      assert.deepEqual(final.changedPaths, ["value.ts"]);
      rows.push({ runtime, route, kind, compiler, taskKind, result, finish,
        afterRun: { sourceRevisionId: afterRun.sourceRevisionId, validations: afterRun.validations },
        final: { sourceRevisionId: final.sourceRevisionId, validations: final.validations },
        manifestUnchanged: true, compilerDidNotEmitOrChangeSource: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  for (const command of ['node -e "process.exit(0)"', 'tsc --noEmit && node -e "process.exit(0)"']) {
    const root = await mkdtemp(join(tmpdir(), "blame-custom-types-"));
    try {
      await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { types: command }, packageManager: "npm" }));
      await symlink(installed, join(root, "node_modules"));
      await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
        noEmit: true, types: [], skipLibCheck: true,
      }, include: ["value.ts"] }));
      await writeFile(join(root, "value.ts"), "export const value: number = 1;\n");
      const workspace = new LightWorkspace(root, { sessionId: "custom-types" });
      const taskKind = (await readTaskCatalog(root)).find(task => task.script === "types").kind;
      assert.equal(taskKind, "custom");
      const result = await completed(workspace, { kind: "command", command: "npm run types" });
      const snapshot = await new SessionJournal(root, "custom-types").completionSnapshot();
      assert.equal(result.status, "ok");
      assert.equal(result.data?.validation, undefined);
      assert.equal(snapshot.validations.some(check => check.taskKind === "typecheck"), false);
      rows.push({ runtime, kind: "custom", command, taskKind, result, validations: snapshot.validations,
        noCompilerEvidenceInvented: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}
assert.ok(rows.length);
process.stdout.write(JSON.stringify({ method: "Actual installed TypeScript compiler on isolated single-source npm projects. Command/project routes, passing/current failing/stale source, and two custom scripts. No model calls, source repair, compiler output or arbitrary feature acceptance invented.", compiler, rows }, null, 2) + "\n");
