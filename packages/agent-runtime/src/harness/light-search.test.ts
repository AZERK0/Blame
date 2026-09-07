import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LightWorkspace } from "./light-workspace.js";
import type { LightToolResult } from "./light-contracts.js";

const searches = [
  { query: "std::vector", decoy: "std::string", path: "std.txt" },
  { query: "xlink:href", decoy: "xlink:title", path: "xlink.txt" },
  { query: "https://api.example/v2", decoy: "https://other.example", path: "https.txt" },
  { query: '[data-state="open"]', decoy: 'data-state="closed"', path: "data-state.txt" },
  { query: "left+=right", decoy: "left = other", path: "left.txt" },
  { query: "failure|retry", decoy: "failure pending", path: "failure.txt" },
];

for (const engine of ["ripgrep", "node"])
  for (const search of searches)
    test(`${engine} preserves literal ${search.query} beyond prefix decoys`, async () => {
      await searchFixture(engine, search, async (workspace) => {
        const result = data(await workspace.searchCode({ query: search.query, mode: "text" }));
        const matches = result.results as Array<Record<string, unknown>>;
        assert.equal(matches.length, 1);
        assert.equal(matches[0]?.reason, "lexical_exact");
        assert.equal(matches[0]?.snippet, `target ${search.query}`);
        assert.deepEqual(matches[0]?.lines, [51, 51]);
        const read = data(await workspace.readCode({ target: String(matches[0]?.alias) }, {}));
        assert.ok(String(read.content).includes(search.query));
      });
    });

for (const engine of ["ripgrep", "node"])
  test(`${engine} keeps punctuation in whitespace-separated terms`, async () => {
    await searchFixture(engine, searches[0]!, async (workspace) => {
      const result = data(await workspace.searchCode({ query: "std::vector unavailable", mode: "text" }));
      const matches = result.results as Array<Record<string, unknown>>;
      assert.equal(matches.length, 1);
      assert.equal(matches[0]?.snippet, "target std::vector");
    });
  });

async function searchFixture(
  engine: string,
  search: { query: string; decoy: string; path: string },
  run: (workspace: LightWorkspace) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-literal-search-"));
  const previous = process.env.BLAME_RIPGREP_COMMAND;
  if (engine === "node") process.env.BLAME_RIPGREP_COMMAND = join(root, "missing-rg");
  try {
    await writeFile(join(root, search.path), `${`${search.decoy}\n`.repeat(50)}target ${search.query}\n`);
    await run(new LightWorkspace(root, { sessionId: "literal-search" }));
  } finally {
    if (previous === undefined) delete process.env.BLAME_RIPGREP_COMMAND;
    else process.env.BLAME_RIPGREP_COMMAND = previous;
    await rm(root, { recursive: true, force: true });
  }
}

function data(result: LightToolResult<unknown>) {
  assert.equal(result.status, "ok");
  return (result.status === "ok" ? result.data : {}) as Record<string, unknown>;
}
