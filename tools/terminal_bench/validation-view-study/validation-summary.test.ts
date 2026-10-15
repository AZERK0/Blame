import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";

const runtime = process.env.BLAME_GUIDANCE_RUNTIME;
const { validationOutput } = await import(runtime ? `${runtime}/validation-output.js` : "./validation-output.js") as typeof import("./validation-output.js");
const summaries = ["ℹ tests 12", "ℹ pass 12", "ℹ fail 0", "  246 passing (1s)", "  1350 passing (3s)", "  9 pending"];
const transcript = (padding: number) => "prologue\n" + "P".repeat(padding) + "\n" + summaries.join("\n") + "\n" + "Q".repeat(padding) + "\nepilogue";

test("middle aggregates from multiple stages survive the same 900-character view", async () => {
  await fixture({}, async (_, root) => {
    const full = transcript(7000), result = await validationOutput(root, full);
    assert.ok(result.output.length <= 900);
    for (const line of summaries) assert.ok(result.output.includes(line.trim()), line);
    assert.match(result.output, /not verification/u);
    assert.equal(await readFile(join(root, result.outputLog!), "utf8"), full);
  });
});

test("identical stage summaries remain separate observations", async () => {
  await fixture({}, async (_, root) => {
    const full = "P".repeat(5000) + "\n  7 passing (1s)\n  7 passing (1s)\n" + "Q".repeat(5000);
    const result = await validationOutput(root, full);
    assert.equal((result.output.match(/7 passing \(1s\)/gu) ?? []).length, 2);
    assert.match(result.output, /2\/2 detected lines/u);
    assert.ok(result.output.length <= 900);
  });
});

test("ordinary logs retain their existing bounded context", async () => {
  await fixture({}, async (_, root) => {
    const full = "start\n" + "x".repeat(5000) + "\nend";
    const result = await validationOutput(root, full);
    assert.match(result.output, /^start/u); assert.match(result.output, /end$/u);
    assert.doesNotMatch(result.output, /Summary index/u);
    assert.ok(result.output.length <= 900);
  });
});

test("short output stays byte exact", async () => {
  await fixture({}, async (_, root) => {
    const output = "  12 passing (1s)\n";
    assert.deepEqual(await validationOutput(root, output), { output });
  });
});

test("excessive summaries are explicitly partial and remain bounded", async () => {
  await fixture({}, async (_, root) => {
    const full = "P".repeat(5000) + "\n" + Array.from({ length: 80 }, (_, i) => `  ${i + 1} passing (1s)`).join("\n") + "\n" + "Q".repeat(5000);
    const result = await validationOutput(root, full);
    assert.ok(result.output.length <= 900);
    assert.match(result.output, /\/80 detected lines/u);
    assert.match(result.output, /Other summary lines omitted/u);
    assert.doesNotMatch(result.output, /3240 passing/u); // Never sum different stages.
  });
});

test("safe logging failure retains summaries without following a symlink", async () => {
  await fixture({}, async (_, root) => {
    const external = await mkdtemp(join(tmpdir(), "validation-view-outside-"));
    try {
      await symlink(external, join(root, ".blame"), "dir");
      const result = await validationOutput(root, transcript(7000));
      assert.equal(result.outputLog, undefined); assert.ok(result.output.length <= 4000);
      for (const line of summaries) assert.ok(result.output.includes(line.trim()));
      assert.deepEqual(await readdir(external), []);
    } finally { await rm(external, { recursive: true, force: true }); }
  });
});

for (const failing of [false, true]) {
  test(`actual ${failing ? "failing" : "passing"} command retains counters without admitting verification`, async () => {
    await fixture({
      "cases.cjs": "const {test}=require('node:test');const assert=require('node:assert/strict');test('alpha',()=>{});test('beta',()=>assert.equal(1," + (failing ? "2" : "1") + "));\n",
    }, async (workspace, root) => {
      const before = 'node -e "console.log(\'P\'.repeat(7000))"';
      const after = 'node -e "console.log(\'Q\'.repeat(7000))"';
      const command = before + " && node --test cases.cjs; validation_view_exit=$?; " + after + "; exit $validation_view_exit";
      const result = data(await workspace.runTask({ kind: "command", command }, {}));
      assert.equal(result.exitCode, failing ? 1 : 0);
      assert.equal(result.reporting.counts.passed, failing ? 1 : 2);
      assert.equal(result.reporting.counts.failed, failing ? 1 : 0);
      assert.equal(result.reporting.counts.pending, null);
      assert.equal(result.reporting.admission, "unverified");
      assert.equal(result.validation.status, failing ? "failed" : "unknown");
      assert.match(result.output, failing ? /fail 1/u : /pass 2/u);
      assert.ok(result.output.length <= (failing ? 4000 : 900));
      const full = await readFile(join(root, result.outputLog), "utf8");
      assert.match(full, failing ? /fail 1/u : /pass 2/u);
    });
  });
}
