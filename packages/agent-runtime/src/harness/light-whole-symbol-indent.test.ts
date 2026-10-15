import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";

for (const [path, indent, newline] of [
  ["value.js", "  ", "\n"],
  ["value.ts", "\t", "\r\n"],
  ["value.tsx", "    ", "\n"],
] as const) {
  test(`whole ${path} replacements accept the existing first-line indent once`, async () => {
    const oldMethod = `${indent}value() {${newline}${indent}  return 1;${newline}${indent}}`;
    // Subsequent lines, including template literal payload, must remain byte exact.
    const method = `${indent}value() {${newline}${indent}  return \`é${newline}  literal\`;${newline}${indent}}`;
    const source = `export class Value {${newline}${oldMethod}${newline}${indent}other() { return 3; }${newline}}${newline}`;
    await fixture({ [path]: source }, async (workspace, root) => {
      for (let iteration = 0; iteration < 3; iteration++) {
        await workspace.readCode({ target: `${path}#Value.value` }, {});
        data(await workspace.editCode({ operations: [{ kind: "symbol", target: `${path}#Value.value`, action: "replace", content: method }] }));
        assert.equal(await readFile(join(root, path), "utf8"), source.replace(oldMethod, method));
      }
    });
  });
}

test("whole replacement copied from the symbol read preserves its relative first line", async () => {
  const source = "class Value {\n  value() { return 1; }\n}\n";
  await fixture({ "value.js": source }, async (workspace, root) => {
    const read = data(await workspace.readCode({ target: "value.js#Value.value" }, {}));
    data(await workspace.editCode({ operations: [{ kind: "symbol", target: read.alias, action: "replace", content: read.signature + read.body }] }));
    assert.equal(await readFile(join(root, "value.js"), "utf8"), source);
  });
});

test("an inline declaration keeps the exact proposed leading whitespace", async () => {
  const source = "class Value { value() { return 1; } }\n";
  await fixture({ "value.js": source }, async (workspace, root) => {
    await workspace.readCode({ target: "value.js#Value.value" }, {});
    data(await workspace.editCode({ operations: [{ kind: "symbol", target: "value.js#Value.value", action: "replace", content: "  value() { return 2; }" }] }));
    assert.equal(await readFile(join(root, "value.js"), "utf8"), source.replace("value() { return 1; }", "  value() { return 2; }"));
  });
});

test("signature-only observation still cannot replace the complete declaration", async () => {
  const source = "class Value {\n  value() { return 1; }\n}\n";
  await fixture({ "value.js": source }, async (workspace, root) => {
    await workspace.readCode({ target: "value.js#Value.value", view: "signature" }, {});
    assert.equal((await workspace.editCode({ operations: [{ kind: "symbol", target: "value.js#Value.value", action: "replace", content: "  value() { return 2; }" }] })).status, "blocked");
    assert.equal(await readFile(join(root, "value.js"), "utf8"), source);
  });
});
