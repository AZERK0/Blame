// Independent lexical-token audit for explicitly mechanical renames. The
// language service under study is never used to supply expected references.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const ts = createRequire(join(repo, "packages/agent-runtime/package.json"))("typescript");
const [workspace, taskId] = process.argv.slice(2);
const protocol = JSON.parse(await readFile(join(repo,
  "docs/experiments/light-harness-semantic-references-2026-10-12/protocol.json"), "utf8"));
const task = protocol.tasks.find(task => task.id === taskId);
if (!task) throw new Error("Unknown registered task");
const sha = text => createHash("sha256").update(text).digest("hex");
function tokens(text, rename) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, text);
  const output = [];
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan())
    output.push([token, rename && token === ts.SyntaxKind.Identifier && scanner.getTokenText() === task.oldName
      ? task.newName : scanner.getTokenText()]);
  return output;
}
const checks = [];
for (const [path, expectedHash] of Object.entries(task.selectedSourceSha256)) {
  const original = await readFile(join(repo, ".blame/research/semantic-references/date-fns", path), "utf8");
  if (sha(original) !== expectedHash) throw new Error("Registered source changed: " + path);
  const actual = await readFile(join(workspace, path), "utf8");
  checks.push({ name: "only-requested-identifier-renames:" + path,
    passed: JSON.stringify(tokens(original, true)) === JSON.stringify(tokens(actual, false)),
    sourceSha256: sha(actual) });
}
console.log(JSON.stringify({ checks, compiler: ts.version,
  criterion: "All requested function/import/call identifiers use the new name, pre-existing aliases preserved; no other nontrivia tokens change. Compiler/tests/source-scope audited separately." }));
if (!checks.every(check => check.passed)) process.exitCode = 1;
