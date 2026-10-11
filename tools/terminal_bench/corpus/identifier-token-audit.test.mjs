import assert from "node:assert/strict";
import test from "node:test";
import { onlyIdentifierRename } from "./identifier-token-audit.mjs";

const original = 'export function calculate(n: number) { return `${n}`; }\nconst before = `${calculate(1)}`;\nconst after = calculate(2);\nconst label = "calculate"; // calculate\n';
const changed = original.replaceAll("function calculate", "function updated").replaceAll("calculate(", "updated(");
test("identifier tokens remain distinct inside and after template interpolation", () => {
  assert.ok(onlyIdentifierRename(original, changed, "calculate", "updated"));
  assert.equal(onlyIdentifierRename(original, original, "calculate", "updated"), false);
});
test("literal/operator/assertion changes cannot be hidden by a valid rename", () => {
  for (const tampered of [changed.replace('"calculate"', '"updated"'), changed.replace("updated(2)", "updated(3)"),
    changed.replace("return `${n}`", "return `${n + 1}`")])
    assert.equal(onlyIdentifierRename(original, tampered, "calculate", "updated"), false);
});
test("trivia is ignored while explicit import aliases and string paths are preserved", () => {
  const before = '/** calculate */\nimport { calculate as compute } from "./calculate.js";\nconst n = compute(1);\n';
  const after = '/* updated comment */\nimport { updated as compute } from "./calculate.js"; const n = compute(1);\n';
  assert.ok(onlyIdentifierRename(before, after, "calculate", "updated"));
  assert.equal(onlyIdentifierRename(before, after.replace('"./calculate.js"', '"./updated.js"'), "calculate", "updated"), false);
});
