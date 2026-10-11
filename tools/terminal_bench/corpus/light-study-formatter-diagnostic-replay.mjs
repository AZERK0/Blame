import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const rows = [];
for (const requested of process.argv.slice(2)) {
  const runtime = resolve(requested);
  const { LightWorkspace } = await import(pathToFileURL(join(runtime, "dist/harness/light-workspace.js")));
  const { SessionJournal } = await import(pathToFileURL(join(runtime, "dist/harness/session-journal.js")));
  for (const output of ["", " \n\t", "\n parser failure: line 4 \n"]) {
    const root = await mkdtemp(join(tmpdir(), "blame-formatter-diagnostic-"));
    const previousPath = process.env.PATH;
    try {
      const source = "export const value=1\n";
      await mkdir(join(root, "node_modules/.bin"), { recursive: true });
      await writeFile(join(root, "package.json"), "{}\n");
      await writeFile(join(root, "value.ts"), source);
      const executable = ["#!/usr/bin/env node", "process.stdin.resume();",
        "process.stdin.on('end', () => {",
        "process.stdout.write(" + JSON.stringify(output) + ");",
        "process.stderr.write(" + JSON.stringify(output) + ");",
        "process.exit(7);", "});"].join("\n");
      await writeFile(join(root, "node_modules/.bin/prettier"), executable);
      await chmod(join(root, "node_modules/.bin/prettier"), 0o755);
      // Launch the controlled binary directly; a package manager may replace
      // an incomplete fake dependency installation with real Prettier.
      process.env.PATH = join(root, "node_modules/.bin") + delimiter + previousPath;
      const workspace = new LightWorkspace(root, { sessionId: "formatter-diagnostic" });
      const journal = new SessionJournal(root, "formatter-diagnostic");
      const before = await journal.completionSnapshot();
      const result = await workspace.tasks.run({ kind: "command", command: "prettier --write value.ts" });
      const after = await journal.completionSnapshot();
      assert.equal(result.status, "blocked");
      assert.equal(result.category, "code");
      assert.equal(await readFile(join(root, "value.ts"), "utf8"), source);
      assert.equal(await readFile(join(root, "package.json"), "utf8"), "{}\n");
      assert.equal(after.sourceRevisionId, before.sourceRevisionId);
      assert.deepEqual(after.validations, before.validations);
      assert.deepEqual(after.changedPaths, []);
      if (output.trim()) assert.ok(result.message.includes("parser failure: line 4"));
      rows.push({ runtime, output, result, actionableDiagnostic: output.trim()
        ? result.message.includes("parser failure: line 4")
        : result.message === "Formatter exited with code 7.",
        failureIsNonmutating: true, validationsUnchanged: true, manifestUnchanged: true });
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      await rm(root, { recursive: true, force: true });
    }
  }
}
assert.ok(rows.length);
process.stdout.write(JSON.stringify({ method: "Controlled actual exit-7 formatter process, empty/whitespace/meaningful output. Direct executable isolation, source and journal checks; no model or completion claim.", rows }, null, 2) + "\n");
