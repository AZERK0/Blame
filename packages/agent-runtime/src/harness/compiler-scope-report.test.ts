import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compilerScopeCapture, type CompilerScopeReport } from "./compiler-scope-report.js";
import { LightWorkspace } from "./light-workspace.js";
import { LightFinishService } from "./light-finish-service.js";
import { WorkspaceFiles } from "./workspace-files.js";
import { readTaskCatalog, taskInvocation } from "./task-catalog.js";
const command = "node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json";

async function fixture(run: (root: string, workspace: LightWorkspace) => Promise<void>, hooks = false) {
  const root = await mkdtemp(join(tmpdir(), "blame-compiler-scope-"));
  try {
    await mkdir(join(root, "node_modules")); await mkdir(join(root, ".blame"));
    await symlink(fileURLToPath(new URL("../../node_modules/typescript", import.meta.url)), join(root, "node_modules/typescript"));
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: command,
      ...(hooks ? { pretypecheck: "node -e \"require('node:fs').writeFileSync('.blame/hook','ran')\"" } : {}) } }));
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, types: [] }, files: ["index.ts"], exclude: ["dependency.ts"] }));
    await writeFile(join(root, "index.ts"), "export { value } from './dependency';\n");
    await writeFile(join(root, "dependency.ts"), "export const value: number = 1;\n");
    await run(root, new LightWorkspace(root, { sessionId: "scope" }));
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function add(workspace: LightWorkspace, path: string, content: string) {
  assert.equal((await workspace.editCode({ operations: [{ kind: "patch", path, patch: content }] })).status, "ok");
}
function data(result: Awaited<ReturnType<LightWorkspace["runTask"]>>) {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return (result as { data: { command: string; output: string; validation: { compilerScope: CompilerScopeReport; paths: string[] } } }).data;
}

test("actual compiler listing distinguishes an imported file from excluded added tests and docs", async () => {
  await fixture(async (root, workspace) => {
    await workspace.readCode({ target: "dependency.ts", view: "raw" }, {});
    const changed = await workspace.editCode({ operations: [{ kind: "patch", path: "dependency.ts", patch: "*** Begin Patch\n*** Update File: dependency.ts\n@@\n-export const value: number = 1;\n+export const value: number = 2;\n*** End Patch" }] });
    assert.equal(changed.status, "ok", JSON.stringify(changed));
    await add(workspace, "excluded.test.ts", "export const invalid: number = 'unchecked';\n");
    await add(workspace, "extra.md", "# Unchecked documentation\n");
    const result = data(await workspace.runTask({ kind: "project", task: "typecheck" }, {}));
    const report = result.validation.compilerScope;
    assert.match(result.command, /npm run typecheck -- --listFiles --pretty false/u);
    assert.equal(report.status, "reported");
    assert.deepEqual(report.changedFilesReported, ["dependency.ts"]); // Imported despite config exclude.
    assert.deepEqual(report.changedFilesNotReported, ["excluded.test.ts", "extra.md"]);
    assert.equal(report.reportedWorkspaceFiles, 2);
    assert.equal(report.manifestEnvironment?.before, report.manifestEnvironment?.after);
    assert.deepEqual(result.validation.paths, []); // Feedback never grants source admission.
    assert.ok(!result.output.includes(join(root, "index.ts")));
    const notifications: { verified: boolean; validationReport?: unknown }[] = [];
    const finish = new LightFinishService({ workspaceRoot: root, conversationId: "scope", onComplete: n => { notifications.push(n); }, taskContract: { session_id: "scope", required_checks: [{ id: "types", task: "typecheck" }] } });
    await finish.finish("The invocation passed; excluded additions remain unchecked.", {} as never);
    assert.equal(notifications.at(-1)?.verified, false);
    assert.match(JSON.stringify(notifications.at(-1)?.validationReport), /excluded.test.ts/u);
    await writeFile(join(root, "index.ts"), "export const broken: number = 'changed';\n");
    const current = await workspace.readCode({ target: "@checks" }, {});
    assert.ok(!JSON.stringify(current).includes('"status":"reported"')); // Previous source is never current evidence.
  });
});

test("listing mode still detects compiler errors rather than only listing files", async () => {
  await fixture(async (root, workspace) => {
    await writeFile(join(root, "dependency.ts"), "export const value: number = 'wrong';\n");
    const result = await workspace.runTask({ kind: "project", task: "typecheck" }, {});
    assert.equal(result.status, "blocked");
    assert.match(JSON.stringify(result), /TS2322/u);
    const checks = await workspace.readCode({ target: "@checks" }, {});
    assert.match(JSON.stringify(checks), /"status":"unknown"/u);
    assert.ok(!JSON.stringify(checks).includes('"admission":"admitted"'));
  });
});

test("hooks keep their original invocation and explicitly unknown compiler scope", async () => {
  await fixture(async (root, workspace) => {
    await add(workspace, "excluded.test.ts", "export const invalid: number = 'unchecked';\n");
    const result = data(await workspace.runTask({ kind: "project", task: "typecheck" }, {}));
    assert.equal(result.command, "npm run typecheck");
    assert.equal(result.validation.compilerScope.status, "unknown");
    assert.deepEqual(result.validation.compilerScope.changedFilesUnknown, ["excluded.test.ts"]);
    assert.equal(await readFile(join(root, ".blame/hook"), "utf8"), "ran");
  }, true);
});

test("unsupported composite tasks are not rewritten or granted a compiler footprint", async () => {
  await fixture(async (root, workspace) => {
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: command + " || true" } }));
    const result = data(await workspace.runTask({ kind: "project", task: "typecheck" }, {}));
    assert.equal(result.command, "npm run typecheck");
    assert.equal(result.validation.compilerScope.status, "unknown");
  });
});

test("partial, stale, missing and identity-changed listings remain unknown with bounded feedback", async () => {
  await fixture(async (root) => {
    const files = new WorkspaceFiles(root), task = (await readTaskCatalog(root)).find(t => t.task_id === "typecheck")!;
    const capture = await compilerScopeCapture(task, taskInvocation(task), files); assert.ok(capture);
    const snapshot = await files.snapshot(), revision = snapshot.revision.source_revision_id;
    const changed = Array.from({ length: 25 }, (_, i) => `extra-${i}.test.ts`);
    const result = { all: join(root, "index.ts") + "\n", exitCode: 0, failed: false };
    const complete = await capture.observe(result, snapshot, changed, revision);
    assert.equal(complete.report.changedFilesNotReported.length, 20); assert.equal(complete.report.omittedChangedFiles, 5);
    for (const interruption of ["output_limit", "cancelled", "timed_out"] as const) {
      const partial = await capture.observe({ ...result, failed: true, interruption }, snapshot, changed, revision);
      assert.equal(partial.report.status, "unknown"); assert.equal(partial.report.changedFilesNotReported.length, 0);
    }
    assert.equal((await capture.observe(result, snapshot, changed, "older-source")).report.status, "stale");
    assert.equal((await capture.observe({ ...result, all: "" }, snapshot, changed, revision)).report.status, "unknown");
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "node other.js" } }));
    assert.equal((await capture.observe(result, snapshot, changed, revision)).report.status, "unknown");
  });
});
