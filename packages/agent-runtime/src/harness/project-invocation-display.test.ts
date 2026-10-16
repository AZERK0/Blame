import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";
import { SessionJournal } from "./session-journal.js";

test("project build reports the npm wrapper while preserving lifecycle execution", async () => {
  await fixture({
    "package.json": JSON.stringify({ scripts: {
      prebuild: "node hook.cjs", build: "node hook.cjs", postbuild: "node hook.cjs",
    } }),
    "hook.cjs": "require('fs').appendFileSync('.blame/hooks',process.env.npm_lifecycle_event+'\\n');\n",
  }, async (workspace, root) => {
    const result = data(await workspace.runTask({ kind: "project", task: "build" }, {}));
    assert.equal(result.exitCode, 0);
    assert.equal(result.command, "npm run build");
    assert.equal(await readFile(join(root, ".blame/hooks"), "utf8"), "prebuild\nbuild\npostbuild\n");
    const journal = new SessionJournal(root, "guidance");
    await journal.hydrate();
    assert.equal(journal.currentValidations()[0]?.command, "npm run build");
  });
});

test("project display preserves literal argv boundaries and never evaluates arguments", { skip: process.platform === "win32" }, async () => {
  const args = ["two words", "a'b", "$(touch SHOULD_NOT_EXIST)", "", "line\nbreak", "λ"];
  // Empty arguments are not valid tool inputs, so use the nonempty subset here.
  const supplied = args.filter(Boolean);
  await fixture({
    "package.json": JSON.stringify({ scripts: { test: "node probe.cjs" } }),
    "probe.cjs": "require('fs').writeFileSync('.blame/argv',JSON.stringify(process.argv.slice(2)));\n",
  }, async (workspace, root) => {
    const result = data(await workspace.runTask({ kind: "project", task: "test", args: supplied }, {}));
    assert.equal(result.exitCode, 0);
    assert.deepEqual(JSON.parse(await readFile(join(root, ".blame/argv"), "utf8")), supplied);
    const decoded = execFileSync("/bin/sh", ["-c", `set -- ${result.command}; printf '%s\\0' "$@"`], { cwd: root, encoding: "utf8" }).split("\0").slice(0, -1);
    assert.deepEqual(decoded, ["npm", "run", "test", "--", ...supplied]);
    await assert.rejects(readFile(join(root, "SHOULD_NOT_EXIST")), { code: "ENOENT" });
    assert.notEqual(result.validation?.status, "passed", "A successful process is not admitted test evidence");
  });
});

test("raw command presentation retains the literal caller command", async () => {
  await fixture({ "package.json": "{}" }, async (workspace) => {
    const command = "node -e 'console.log(\"raw command\")'";
    const result = data(await workspace.runTask({ kind: "command", command }, {}));
    assert.equal(result.command, command);
    assert.equal(result.exitCode, 0);
  });
});
