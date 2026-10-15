import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";

test("padded qualified names suggest one exact read without granting coverage", async () => {
  const source = "function calculate() { return 1; }\n";
  await fixture({ "project space/value.ts": source }, async (workspace, root) => {
    const result = await workspace.readCode({ target: "project space/value.ts# calculate" }, {});
    assert.equal(result.status, "blocked");
    const message = (result as { message: string }).message;
    assert.match(message, /No indexed declaration matches/u);
    assert.doesNotMatch(message, /no longer exists/u);
    const suggested = JSON.parse(message.slice(message.indexOf("Suggested read_code input: ") + "Suggested read_code input: ".length));
    assert.deepEqual(suggested, { target: "project space/value.ts#calculate" });
    const edit = { operations: [{ kind: "symbol" as const, target: "project space/value.ts#calculate", action: "replace_body" as const, content: "return 2;" }] };
    assert.equal((await workspace.editCode(edit)).status, "blocked");
    assert.equal(await readFile(join(root, "project space/value.ts"), "utf8"), source);
    data(await workspace.readCode(suggested, {}));
    assert.equal((await workspace.editCode(edit)).status, "ok");
  });
});

test("a trimmed name with multiple declarations does not get a unique suggestion", async () => {
  const source = "function calculate() { return 1; }\nfunction calculate() { return 2; }\n";
  await fixture({ "value.ts": source }, async (workspace, root) => {
    const exact = await workspace.readCode({ target: "value.ts#calculate" }, {});
    assert.equal(exact.status, "blocked");
    assert.match((exact as { message: string }).message, /ambiguous/u);
    const result = await workspace.readCode({ target: "value.ts# calculate" }, {});
    assert.equal(result.status, "blocked");
    assert.doesNotMatch((result as { message: string }).message, /Suggested read_code input/u);
    assert.equal(await readFile(join(root, "value.ts"), "utf8"), source);
  });
});

test("fresh missing selectors and genuinely stale aliases keep distinct diagnoses", async () => {
  await fixture({ "value.ts": "function calculate() { return 1; }\n" }, async (workspace, root) => {
    const missing = await workspace.readCode({ target: "value.ts#missing" }, {});
    assert.equal(missing.status, "blocked");
    assert.match((missing as { message: string }).message, /No indexed declaration matches/u);
    const observed = data(await workspace.readCode({ target: "value.ts#calculate" }, {}));
    await writeFile(join(root, "value.ts"), "function other() { return 2; }\n");
    const stale = await workspace.readCode({ target: observed.alias }, {});
    assert.equal(stale.status, "blocked");
    assert.match((stale as { message: string }).message, /no longer exists/u);
  });
});

test("a padded name never suggests a selector that would resolve to a different alias", async () => {
  const source = "function calculate() { return 1; }\nfunction s1() { return 2; }\n";
  await fixture({ "value.ts": source }, async (workspace, root) => {
    const observed = data(await workspace.readCode({ target: "value.ts#calculate" }, {}));
    assert.equal(observed.alias, "s1");
    const result = await workspace.readCode({ target: "value.ts# s1" }, {});
    assert.equal(result.status, "blocked");
    assert.doesNotMatch((result as { message: string }).message, /Suggested read_code input/u);
    assert.equal(await readFile(join(root, "value.ts"), "utf8"), source);
  });
});
