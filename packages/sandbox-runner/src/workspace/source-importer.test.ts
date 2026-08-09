import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pruneReconstructedClone } from "./source-importer.js";

test("baseline reconstruction preserves every file from the canonical checkout", async () => {
  const root = await fixture();
  try {
    await pruneReconstructedClone(root, [], true);
    assert.equal(
      await readFile(join(root, "README.md"), "utf8"),
      "canonical\n",
    );
    assert.equal(
      await readFile(join(root, "src/index.ts"), "utf8"),
      "export {}\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full reconstruction still prunes canonical files deleted by the workspace", async () => {
  const root = await fixture();
  try {
    await pruneReconstructedClone(root, ["src/index.ts"], false);
    await assert.rejects(readFile(join(root, "README.md")), { code: "ENOENT" });
    assert.equal(
      await readFile(join(root, "src/index.ts"), "utf8"),
      "export {}\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "blame-source-importer-"));
  await mkdir(join(root, "src"));
  await writeFile(join(root, "README.md"), "canonical\n");
  await writeFile(join(root, "src/index.ts"), "export {}\n");
  return root;
}
