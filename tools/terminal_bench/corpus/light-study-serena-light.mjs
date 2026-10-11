// Deterministic mechanism diagnostic. Manual patch targets are supplied by the
// registered fixture, never counted as semantic discovery or model success.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const [repoArg, fixtureArg, rootArg, outputArg] = process.argv.slice(2);
if (!outputArg) throw new Error("Usage: node SCRIPT REPO FIXTURE ROOT OUTPUT");
const repo = resolve(repoArg), root = resolve(rootArg), output = resolve(outputArg);
const fixture = JSON.parse(await readFile(fixtureArg, "utf8"));
const { LightWorkspace } = await import(pathToFileURL(resolve(repo,
  "packages/agent-runtime/dist/harness/light-workspace.js")));
const ledger = { arm: "Light", modelCalls: 0, calls: [], compiler: [], sources: {} };
const save = async () => writeFile(output, JSON.stringify(ledger, null, 2) + "\n");
const snapshot = async () => Object.fromEntries(await Promise.all(
  Object.keys(fixture.files).map(async path => [path, await readFile(resolve(root, path), "utf8")])));
const hashes = source => Object.fromEntries(Object.entries(source).map(([path, text]) =>
  [path, createHash("sha256").update(text).digest("hex")]));
async function call(name, input, fn) {
  const start = performance.now();
  const result = await fn();
  ledger.calls.push({ name, input, result, resultBytes: Buffer.byteLength(JSON.stringify(result)),
    elapsedMs: performance.now() - start });
  await save();
  return result;
}
function compile(phase) {
  const start = performance.now();
  const result = spawnSync(process.execPath, [resolve(repo,
    "packages/agent-runtime/node_modules/typescript/bin/tsc"), "-p", resolve(root, "tsconfig.json")],
    { cwd: root, encoding: "utf8", timeout: 20_000 });
  ledger.compiler.push({ phase, exitCode: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr, error: result.error?.message,
    elapsedMs: performance.now() - start });
}
await mkdir(root, { recursive: true });
await mkdir(resolve(root, "src"), { recursive: true });
for (const [path, text] of Object.entries(fixture.files)) await writeFile(resolve(root, path), text);
await writeFile(resolve(root, "package.json"), JSON.stringify({ type: "module" }));
await writeFile(resolve(root, "tsconfig.json"), JSON.stringify({ compilerOptions: {
  strict: true, noEmit: true, target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext",
  types: [], skipLibCheck: false }, include: ["src/**/*.ts"] }));
await writeFile(resolve(root, ".gitignore"), ".blame/\n.serena/\n");
const initialized = spawnSync("git", ["init", "--quiet", root], { encoding: "utf8" });
if (initialized.status !== 0) throw new Error(initialized.stderr || "Isolated git init failed");
ledger.sources.initial = await snapshot();
ledger.sourceHashesInitial = hashes(ledger.sources.initial);
await save();
try {
  const workspace = new LightWorkspace(root, { sessionId: "serena-comparison" });
  await call("search_code", { query: "calculate", scope: "src", mode: "references" },
    () => workspace.searchCode({ query: "calculate", scope: "src", mode: "references" }));
  for (const path of ["src/original.ts", "src/consumer.ts"]) await call("read_code",
    { target: path, view: "raw" }, () => workspace.readCode({ target: path, view: "raw" }, {}));
  const patch = "*** Begin Patch\n*** Update File: src/original.ts\n@@\n-" +
    fixture.files["src/original.ts"].trimEnd() + "\n+" +
    fixture.files["src/original.ts"].replace("calculate", "evaluate").trimEnd() +
    "\n*** Update File: src/consumer.ts\n@@\n-" + fixture.files["src/consumer.ts"].split("\n")[0] +
    "\n+" + fixture.files["src/consumer.ts"].split("\n")[0].replace("calculate", "evaluate") +
    "\n*** End Patch";
  ledger.manualTargetSelection = "Registered oracle chose the two patch targets; Light has no native semantic rename.";
  await call("edit_code", { operations: [{ kind: "patch", patch }] },
    () => workspace.editCode({ operations: [{ kind: "patch", patch }] }));
  ledger.sources.afterRename = await snapshot();
  compile("afterRename");
  await call("read_code", { target: "src/original.ts#evaluate", view: "symbol" },
    () => workspace.readCode({ target: "src/original.ts#evaluate", view: "symbol" }, {}));
  await writeFile(resolve(root, "src/original.ts"),
    ledger.sources.afterRename["src/original.ts"].replace("return n + 1", "return n + 99"));
  ledger.sources.externalChange = await snapshot();
  await save();
  await call("edit_code", { operations: [{ kind: "symbol", target: "src/original.ts#evaluate",
    action: "replace_body", content: "{ return n * 2; }" }] },
    () => workspace.editCode({ operations: [{ kind: "symbol", target: "src/original.ts#evaluate",
      action: "replace_body", content: "{ return n * 2; }" }] }));
  ledger.sources.afterStaleEdit = await snapshot();
  compile("afterStaleEdit");
} catch (error) { ledger.error = { name: error.name, message: error.message, stack: error.stack }; }
await save();
console.log(JSON.stringify({ arm: ledger.arm, calls: ledger.calls.length,
  statuses: ledger.calls.map(call => [call.name, call.result.status]), compiler: ledger.compiler.map(c => c.exitCode),
  error: ledger.error?.message }));
if (ledger.error) process.exitCode = 1;
