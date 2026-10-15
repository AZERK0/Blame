import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";

async function engineFixture(engine: string, files: Record<string, string>, run: Parameters<typeof fixture>[1]) {
  const previous = process.env.BLAME_RIPGREP_COMMAND;
  try {
    await fixture(files, async (workspace, root) => {
      if (engine === "node") process.env.BLAME_RIPGREP_COMMAND = join(root, "missing-rg");
      await run(workspace, root);
    });
  } finally {
    if (previous === undefined) delete process.env.BLAME_RIPGREP_COMMAND;
    else process.env.BLAME_RIPGREP_COMMAND = previous;
  }
}

for (const engine of ["ripgrep", "node"]) {
  test(`${engine} finds a late contiguous phrase without granting edit coverage`, async () => {
    const source = Array.from({ length: 50 }, (_, i) => `function decoy${i}() { return ${i}; }\n`).join("") + "function needleTarget() { return 1; }\n";
    await engineFixture(engine, { "source.ts": source }, async (workspace, root) => {
      const result = data(await workspace.searchCode({ query: "FUNCTION needleTarget", scope: "source.ts", mode: "text" }));
      assert.equal(result.engine, engine);
      assert.equal(result.results[0].lines[0], 51);
      assert.match(result.results[0].snippet, /function needleTarget/u);
      assert.ok(result.results.length <= 8);
      const edit = { operations: [{ kind: "symbol" as const, target: "source.ts#needleTarget", action: "replace_body" as const, content: "return 2;" }] };
      assert.equal((await workspace.editCode(edit)).status, "blocked");
      assert.equal(await readFile(join(root, "source.ts"), "utf8"), source);
      data(await workspace.readCode({ target: "source.ts#needleTarget" }, {}));
      assert.equal((await workspace.editCode(edit)).status, "ok");
    });
  });

  test(`${engine} retains literal individual terms when no phrase matches`, async () => {
    await engineFixture(engine, { "a.txt": "callback(item)\ncall(item)\n", "b.txt": "otherTerm\n" }, async workspace => {
      const result = data(await workspace.searchCode({ query: "call(item) otherTerm", mode: "text" }));
      assert.deepEqual(result.results.map((r: { path: string }) => r.path).sort(), ["a.txt", "b.txt"]);
      assert.equal(result.results.find((r: { path: string }) => r.path === "a.txt").snippet, "call(item)");
    });
  });

  test(`${engine} never searches outside the requested file for a better phrase`, async () => {
    await engineFixture(engine, { "inside.ts": "const needleTarget = 1;\n", "outside.ts": "function needleTarget() {}\n" }, async workspace => {
      const result = data(await workspace.searchCode({ query: "function needleTarget", scope: "inside.ts", mode: "text" }));
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].path, "inside.ts");
    });
  });

  test(`${engine} preserves matching file paths ahead of phrase content`, async () => {
    await engineFixture(engine, { "function-needleTarget.txt": "unrelated\n", "other.ts": "function needleTarget() {}\n" }, async workspace => {
      const result = data(await workspace.searchCode({ query: "function needleTarget", mode: "text" }));
      assert.equal(result.results[0].path, "function-needleTarget.txt");
      assert.equal(result.results[0].kind, "path");
    });
  });
}
