import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture } from "./light-agent-guidance-fixture.js";

test("repeated headers for one file are diagnosed without widening a symbol edit", async () => {
  const source = "export function calculate(n: number) { return n + 1; }\nexport function second(n: number) { return n + 2; }\n";
  await fixture({ "original.ts": source }, async (workspace, root) => {
    data(await workspace.readCode({ target: "original.ts", view: "raw" }, {}));
    const symbol = data(await workspace.readCode({ target: "original.ts#calculate" }, {}));
    const patch = "*** Begin Patch\n*** Update File: original.ts\n@@\n-export function calculate(n: number) { return n + 1; }\n+export function calculate(n: number) { return n + 3; }\n*** Update File: original.ts\n@@\n-export function second(n: number) { return n + 2; }\n+export function second(n: number) { return n + 4; }\n*** End Patch";
    const rejected = await workspace.editCode({ operations: [{ kind: "patch", target: symbol.alias, patch }] });
    assert.equal(rejected.status, "blocked");
    const recovery = (rejected as { recovery: string }).recovery;
    const correction = JSON.parse(recovery.slice(recovery.indexOf("{"))).patchCorrection;
    assert.equal(correction.reason, "multiple_headers_for_symbol");
    assert.deepEqual(correction.patchPaths, ["original.ts", "original.ts"]);
    assert.equal(correction.patchPathCount, 2);
    assert.match(correction.symbolRoute, /one.*Update File/u);
    assert.match(correction.fileRoute, /omit.*target/u);
    assert.equal(await readFile(join(root, "original.ts"), "utf8"), source);
    assert.equal((await workspace.editCode({ operations: [{ kind: "patch", patch }] })).status, "ok");
    assert.equal(await readFile(join(root, "original.ts"), "utf8"), source.replace("n + 1", "n + 3").replace("n + 2", "n + 4"));
  });
});
