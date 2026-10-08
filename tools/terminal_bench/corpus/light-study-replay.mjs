import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Run once against each frozen runtime. No model or published task solution is used.
const runtime = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
const { LightWorkspace } = await import(
  pathToFileURL(join(runtime, "harness/light-workspace.js"))
);
const { lightRunTaskInputSchema } = await import(
  pathToFileURL(join(runtime, "harness/light-contracts.js"))
);
const root = await mkdtemp(join(tmpdir(), "blame-argv-replay-"));
try {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node --test" } }),
  );
  await writeFile(
    join(root, "sample.test.cjs"),
    "const {test}=require('node:test');test('selected',()=>{});test('other',()=>{throw Error('pre-existing failure')});",
  );
  const workspace = new LightWorkspace(root, { sessionId: "argv-replay" });
  const rows = [];
  for (const input of [
    { kind: "project", task: "test --test-name-pattern=selected" },
    {
      kind: "project",
      task: "test",
      args: ["--test-name-pattern=selected", "--test-reporter=tap"],
    },
    {
      kind: "command",
      command:
        "npm run test -- --test-name-pattern=selected --test-reporter=tap",
    },
  ]) {
    const start = performance.now();
    const parsed = lightRunTaskInputSchema.safeParse(input);
    const result = parsed.success
      ? await workspace.runTask(parsed.data, {})
      : {
          status: "blocked",
          category: "input",
          message: "schema rejects extra argv",
        };
    rows.push({ input, ms: performance.now() - start, result });
  }
  await writeFile(
    output,
    JSON.stringify({ runtime, node: process.version, rows }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      rows.map((r) => ({
        input: r.input,
        status: r.result.status,
        outcome: r.result.data?.check?.outcome,
      })),
    ),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
