import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const installed = resolve(".blame/research/large-project/date-fns/node_modules");
const prefixes = ["npx --no-install prettier", "npm exec --no -- prettier"];
const rows = [];
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, "dist/harness/light-workspace.js")));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, "dist/harness/session-journal.js")));
  for (const prefix of prefixes) for (const kind of ["typescript", "markdown", "invalid-batch"]) {
    const root = await mkdtemp(join(tmpdir(), "blame-npm-formatter-"));
    try {
      const source = "export const value={answer:1}\n";
      const note = "#   Note\n\n Text  \n";
      const manifest = Buffer.from(JSON.stringify({ devDependencies: { prettier: "3.2.5" } }));
      await writeFile(join(root, "package.json"), manifest);
      await symlink(installed, join(root, "node_modules"));
      await writeFile(join(root, "value.ts"), source);
      await writeFile(join(root, "NOTE.md"), note);
      await writeFile(join(root, "invalid.ts"), "export const value = ;\n");
      const path = kind === "markdown" ? "NOTE.md" : "value.ts";
      const input = path === "NOTE.md" ? note : source;
      // Independent direct installed formatter, before the harness invocation.
      const expected = kind === "invalid-batch" ? input : execFileSync(process.execPath,
        [join(installed, "prettier/bin/prettier.cjs"), "--stdin-filepath", join(root, path)],
        { cwd: root, input, encoding: "utf8" });
      const workspace = new LightWorkspace(root, { sessionId: "npm-formatter-replay" });
      await workspace.readCode({ target: path, view: "raw" }, {});
      const journal = new SessionJournal(root, "npm-formatter-replay");
      const before = await journal.completionSnapshot();
      const command = prefix + " --write " + path + (kind === "invalid-batch" ? " invalid.ts" : "");
      const result = await workspace.tasks.run({ kind: "command", command });
      const after = await journal.completionSnapshot();
      const actual = await readFile(join(root, path), "utf8");
      assert.deepEqual(await readFile(join(root, "package.json")), manifest);
      assert.equal(await readFile(join(root, "invalid.ts"), "utf8"), "export const value = ;\n");
      if (result.status === "blocked") {
        assert.equal(actual, input);
        assert.equal(after.sourceRevisionId, before.sourceRevisionId);
        assert.deepEqual(after.validations, before.validations);
      } else {
        assert.notEqual(kind, "invalid-batch");
        assert.equal(actual, expected);
        assert.ok(after.validations.every(check => check.evidenceOrigin === "formatter_output"));
        assert.ok(after.validations.every(check => check.sourceRevisionId === after.sourceRevisionId));
        assert.deepEqual(after.changedPaths, [path]);
      }
      rows.push({ runtime, kind, command, result, expected, actual,
        requestedFormattingPassed: kind !== "invalid-batch" && result.status === "ok" && actual === expected,
        manifestUnchanged: true, invalidSourceUnchanged: true,
        failureIsNonmutating: result.status === "blocked" ? true : null,
        beforeSourceRevision: before.sourceRevisionId, afterSourceRevision: after.sourceRevisionId,
        validations: after.validations, completionNotInvoked: true });
    } finally { await rm(root, { recursive: true, force: true }); }
  }
}
assert.ok(rows.length);
process.stdout.write(JSON.stringify({ method: "Two explicit no-install npm prefixes, real upstream-locked installed Prettier, independently computed formatter output, TS/Markdown and failing multi-file batch. Source/journal checks, no model/gold recovery or finish claim.", rows }, null, 2) + "\n");
