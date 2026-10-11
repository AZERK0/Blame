import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
const repo = resolve(new URL("../../..", import.meta.url).pathname);
const study = join(repo, "docs/experiments/light-harness-semantic-references-2026-10-12");
const work = join(repo, ".blame/research/semantic-references");
const fixture = JSON.parse(await readFile(join(repo,
  "docs/experiments/light-harness-serena-comparison-2026-10-11/fixture.json"), "utf8"));
const output = { modelCalls: 0, fixtureSourceSha256: fixture.sourceSha256, arms: {} };
for (const arm of ["baseline", "modified"]) {
  const module = arm === "baseline" ? join(work, "frozen/baseline/agent-runtime/dist/harness/light-workspace.js")
    : join(repo, "packages/agent-runtime/dist/harness/light-workspace.js");
  const { LightWorkspace } = await import(pathToFileURL(module));
  const root = await mkdtemp(join(tmpdir(), "semantic-reference-replay-"));
  try {
    await mkdir(join(root, "src"));
    for (const [path, content] of Object.entries(fixture.files)) await writeFile(join(root, path), content);
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { types: [], strict: true,
      noEmit: true, module: "NodeNext", moduleResolution: "NodeNext" }, include: ["src/**/*.ts"] }));
    const workspace = new LightWorkspace(root, { sessionId: "reference-replay" });
    const calls = [];
    for (const input of [{ query: "calculate", mode: "references" },
      { query: "src/original.ts#calculate", mode: "references" }]) {
      const started = performance.now();
      const result = await workspace.searchCode(input);
      calls.push({ input, result, elapsedMs: performance.now() - started, bytes: Buffer.byteLength(JSON.stringify(result)) });
    }
    await workspace.readCode({ target: "src/original.ts#calculate", view: "symbol" }, {});
    await writeFile(join(root, "src/original.ts"), fixture.files["src/original.ts"].replace("n + 1", "n + 99"));
    const staleEdit = await workspace.editCode({ operations: [{ kind: "symbol", target: "src/original.ts#calculate",
      action: "replace_body", content: "{ return n * 2; }" }] });
    output.arms[arm] = { calls, staleEdit, finalOriginal: await readFile(join(root, "src/original.ts"), "utf8") };
  } finally { await rm(root, { recursive: true, force: true }); }
}
const { LightWorkspace } = await import(pathToFileURL(join(repo, "packages/agent-runtime/dist/harness/light-workspace.js")));
const workspace = new LightWorkspace(join(work, "date-fns"), { sessionId: "reference-real-project" });
output.realProject = [];
for (const query of ["src/_lib/getTimezoneOffsetInMilliseconds/index.ts#getTimezoneOffsetInMilliseconds",
  "src/_lib/getRoundingMethod/index.ts#getRoundingMethod"]) {
  const started = performance.now();
  const result = await workspace.searchCode({ query, mode: "references" });
  output.realProject.push({ query, result, elapsedMs: performance.now() - started, bytes: Buffer.byteLength(JSON.stringify(result)) });
}
await writeFile(join(study, "local-replay.json"), JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({ bareQueriesRemainLexical: Object.values(output.arms).every(arm =>
  arm.calls[0].result.data?.engine === "lexical_fallback"),
  modifiedIdentityReferenceLines: output.arms.modified.calls[1].result.data?.referenceCount,
  staleEditBlockedBoth: Object.values(output.arms).every(arm => arm.staleEdit.status === "blocked"),
  realProject: output.realProject.map(call => ({ engine: call.result.data?.engine,
    refs: call.result.data?.referenceCount, elapsedMs: call.elapsedMs, warnings: call.result.data?.project?.warnings })) }));
