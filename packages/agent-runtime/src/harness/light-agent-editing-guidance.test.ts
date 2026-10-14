import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { data, fixture, project, source } from "./light-agent-guidance-fixture.js";

test("rename receipt describes actual binding edits and preserved alias spelling", async () => {
  await fixture(project, async (workspace, root) => {
    await workspace.readCode({ target: "original.ts#calculate" }, {});
    const result = data(await workspace.editCode({ operations: [{ kind: "symbol", target: "original.ts#calculate", action: "rename", content: "updatedCalculation" }] }));
    const receipt = result.semanticRename;
    assert.equal(receipt.from, "original.ts#calculate");
    assert.equal(receipt.to, "original.ts#updatedCalculation");
    assert.equal(receipt.identifierEdits, 3);
    assert.deepEqual(receipt.editsByFile, [{ path: "consumer.ts", identifierEdits: 2 }, { path: "original.ts", identifierEdits: 1 }]);
    const example = receipt.examples.find((item: { before: string }) => item.before.includes("as compute"));
    assert.ok(example.after.includes("updatedCalculation as compute"));
    assert.match(receipt.guidance, /source.side|imported.*name/iu);
    assert.match(receipt.guidance, /not.*(?:test|validation)|do not.*(?:test|validation)/iu);
    assert.match(await readFile(join(root, "consumer.ts"), "utf8"), /updatedCalculation as publicName/u);
  });
});
test("scoped multi-file rejection supplies explicit alternatives and applies nothing", async () => {
  await fixture({ "original.ts": source, "other.ts": source }, async (workspace, root) => {
    const read = data(await workspace.readCode({ target: "original.ts#calculate" }, {}));
    const patch = `*** Begin Patch\n*** Update File: original.ts\n@@\n-${source.trimEnd()}\n+${source.replace("n + 1", "n + 2").trimEnd()}\n*** Update File: other.ts\n@@\n-${source.trimEnd()}\n+${source.replace("n + 1", "n + 2").trimEnd()}\n*** End Patch`;
    const rejected = await workspace.editCode({ operations: [{ kind: "patch", target: read.alias, patch }] });
    assert.equal(rejected.status, "blocked");
    const recovery = JSON.parse((rejected as { recovery: string }).recovery.slice((rejected as { recovery: string }).recovery.indexOf("{")));
    assert.equal(recovery.patchCorrection.reason, "multiple_files_for_symbol");
    assert.deepEqual(recovery.patchCorrection.patchPaths, ["original.ts", "other.ts"]);
    assert.match(recovery.patchCorrection.fileRoute, /omit.*target/iu);
    assert.match(recovery.patchCorrection.symbolRoute, /one.*operation/iu);
    assert.equal(await readFile(join(root, "original.ts"), "utf8"), source);
    assert.equal(await readFile(join(root, "other.ts"), "utf8"), source);
    assert.equal((await workspace.editCode({ operations: [{ kind: "patch", patch }] })).status, "ok");
  });
});
test("wrong-file scoped patches identify the mismatch without suggesting an automatic widening", async () => {
  await fixture({ "original.ts": source, "other.ts": source }, async (workspace, root) => {
    const read = data(await workspace.readCode({ target: "original.ts#calculate" }, {}));
    const result = await workspace.editCode({ operations: [{ kind: "patch", target: read.alias, patch: "*** Begin Patch\n*** Update File: other.ts\n@@\n-return 1;\n+return 2;\n*** End Patch" }] });
    assert.equal(result.status, "blocked");
    const recovery = JSON.parse((result as { recovery: string }).recovery.slice((result as { recovery: string }).recovery.indexOf("{")));
    assert.equal(recovery.patchCorrection.reason, "wrong_file_for_symbol");
    assert.equal(recovery.patchCorrection.expectedPath, "original.ts");
    assert.match(recovery.patchCorrection.fileRoute, /review/iu);
    assert.equal(await readFile(join(root, "other.ts"), "utf8"), source);
  });
});
