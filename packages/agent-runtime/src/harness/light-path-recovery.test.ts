import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";
import type { LightToolResult } from "./light-contracts.js";
import { withMissingPathRecovery } from "./light-path-recovery.js";
import { WorkspaceFiles } from "./workspace-files.js";

function recovery(result: LightToolResult<unknown>) {
  assert.equal(result.status, "blocked");
  assert.ok("recovery" in result && result.recovery, JSON.stringify(result));
  return JSON.parse(result.recovery);
}
const source = "export function calculate() { return 1; }\n";

test("a missing directory spelling suggests an explicit read without granting edit coverage", async () => {
  const path = "library/src/methods/parse/parseAsync.ts";
  await fixture({ [path]: source }, async (workspace, root) => {
    const result = await workspace.readCode({ target: "library/src/methods/parseAsync/parseAsync.ts", view: "raw" }, {});
    const hint = recovery(result);
    assert.equal(hint.kind, "missing_workspace_path");
    assert.equal(hint.match, "exact_basename");
    assert.deepEqual(hint.candidates, [{ path, nextRead: { target: `./${path}` } }]);
    const edit = { operations: [{ kind: "symbol" as const, target: `${path}#calculate`, action: "replace_body" as const, content: "return 2;" }] };
    assert.equal((await workspace.editCode(edit)).status, "blocked");
    assert.equal(await readFile(join(root, path), "utf8"), source);
    data(await workspace.readCode(hint.candidates[0].nextRead, {}));
    assert.equal((await workspace.editCode(edit)).status, "ok");
    assert.match(await readFile(join(root, path), "utf8"), /return 2/u);
  });
});

test("ambiguous basenames remain explicit candidates with no fuzzy or case-insensitive matches", async () => {
  await fixture({ "a/value.ts": source, "b/value.ts": source, "c/Value.ts": source, "d/value.test.ts": source }, async workspace => {
    const hint = recovery(await workspace.readCode({ target: "missing/value.ts" }, {}));
    assert.deepEqual(hint.candidates.map((c: { path: string }) => c.path), ["a/value.ts", "b/value.ts"]);
    assert.match(hint.guidance, /not resolved targets/u);
  });
});

test("generic basenames keep the original failure instead of an arbitrary shortlist", async () => {
  await fixture(Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`${i}/index.ts`, source])), async workspace => {
    const result = await workspace.readCode({ target: "missing/index.ts" }, {});
    assert.equal(result.status, "blocked");
    assert.ok(!("recovery" in result));
  });
});

test("tracked deleted, protected, dependency and symlink files are not offered", async () => {
  await fixture({ "actual/value.ts": source, "gone/value.ts": source, "node_modules/value.ts": source, ".gitignore": "ignored/\n", "ignored/value.ts": source }, async (workspace, root) => {
    await mkdir(join(root, "linked"));
    await symlink(join(root, "actual/value.ts"), join(root, "linked/value.ts"));
    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["add", "-f", "actual", "gone", "linked", "node_modules", ".gitignore"], { cwd: root });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "Fixture"], { cwd: root });
    await rm(join(root, "gone/value.ts"));
    const hint = recovery(await workspace.readCode({ target: "missing/value.ts" }, {}));
    assert.deepEqual(hint.candidates.map((c: { path: string }) => c.path), ["actual/value.ts"]);
  });
});

test("the suggested read cannot confuse a root filename with an existing symbol alias", async () => {
  await fixture({ "s1": "literal file\n", "original.ts": source }, async workspace => {
    const observed = data(await workspace.readCode({ target: "original.ts#calculate" }, {}));
    assert.equal(observed.alias, "s1");
    const hint = recovery(await workspace.readCode({ target: "missing/s1" }, {}));
    assert.equal(data(await workspace.readCode(hint.candidates[0].nextRead, {})).content, "literal file\n");
  });
});

test("successful reads, absent basenames, qualified targets and policy refusals keep their existing behavior", async () => {
  await fixture({ "actual/value.ts": source }, async workspace => {
    assert.equal(data(await workspace.readCode({ target: "actual/value.ts", view: "raw" }, {})).content, source);
    for (const target of ["missing/no-such-file.ts", "missing/value.ts#calculate", "../value.ts", "node_modules/value.ts", ".git/value.ts"]) {
      const result = await workspace.readCode({ target }, {});
      assert.equal(result.status, "blocked");
      assert.ok(!("recovery" in result) || !result.recovery?.includes("missing_workspace_path"), JSON.stringify(result));
    }
  });
});

test("an aborted read offers no recovery candidates", async () => {
  await fixture({ "actual/value.ts": source }, async workspace => {
    const result = await workspace.readCode({ target: "missing/value.ts" }, { signal: AbortSignal.abort(new Error("Cancelled read")) });
    assert.equal(result.status, "blocked");
    assert.ok("message" in result && /Cancelled read/.test(result.message));
    assert.ok(!("recovery" in result));
  });
});

test("an unrelated ENOENT cannot misreport an existing requested file as missing", async () => {
  await fixture({ "actual/value.ts": source, "other/value.ts": source }, async (_workspace, root) => {
    const files = new WorkspaceFiles(root), failure = Object.assign(new Error("Journal is missing"), { code: "ENOENT" });
    await assert.rejects(withMissingPathRecovery({ files, input: { target: "actual/value.ts" },
      literalPath: true, snapshot: await files.snapshot() }, async () => { throw failure; }), error => error === failure);
  });
});

test("stale indexed candidates cannot force an unbounded metadata scan", async () => {
  await fixture({ "z/value.ts": source }, async (_workspace, root) => {
    const files = new WorkspaceFiles(root), snapshot = await files.snapshot();
    snapshot.files = [...Array.from({ length: 32 }, (_, i) => `${String(i).padStart(2, "0")}/value.ts`), "z/value.ts"];
    const failure = Object.assign(new Error("Requested file is missing"), { code: "ENOENT" });
    await assert.rejects(withMissingPathRecovery({ files, input: { target: "missing/value.ts" },
      literalPath: true, snapshot }, async () => { throw failure; }), error => error === failure);
  });
});

test("cancellation during candidate inspection discards recovery output", async () => {
  await fixture({ "actual/value.ts": source }, async (_workspace, root) => {
    const files = new WorkspaceFiles(root), controller = new AbortController(), failure = new Error("Cancelled lookup");
    const fileSize = files.fileSize.bind(files);
    files.fileSize = async path => { const size = await fileSize(path); controller.abort(failure); return size; };
    await assert.rejects(withMissingPathRecovery({ files, input: { target: "missing/value.ts" }, literalPath: true,
      snapshot: await files.snapshot(), signal: controller.signal }, async () => { throw Object.assign(new Error("Missing"), { code: "ENOENT" }); }), error => error === failure);
  });
});
