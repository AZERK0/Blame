import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { parseCode } from "./code-intelligence.js";
import { validateContent } from "./content-validation.js";
import { LightWorkspace } from "./light-workspace.js";

const execute = promisify(execFile);
const ordinaryFunction = "int value(void) { return 1; }\n";
const macroFunction = [
  '#include "regions.h"',
  "int value(void) {",
  "  BEGIN_REGION",
  "  return 7;",
  "  END_REGION",
  "}",
  "",
].join("\n");
const regionDefinitions = "#define BEGIN_REGION {\n#define END_REGION }\n";

for (const extension of ["c", "h", "cpp", "cc", "cxx", "hpp"]) {
  test(`unpreprocessed ${extension} remains unverified even without parser errors`, async () => {
    const result = await validateContent({
      content: Buffer.from(ordinaryFunction),
      path: `value.${extension}`,
      workspaceRoot: tmpdir(),
    });
    assert.equal(result.status, "unsupported");
    assert.match(result.diagnostics.join("\n"), /project compiler/u);
  });
}

for (const [extension, compiler] of [
  ["c", "cc"],
  ["cpp", "c++"],
]) {
  test(`valid macro-based ${extension} patches commit without claiming syntax validation`, async () => {
    await fixture(async (root, workspace) => {
      const path = `value.${extension}`;
      assert.ok(parseCode(path, Buffer.from(macroFunction)).errorCount > 0);
      const result = await workspace.editCode({
        operations: [{ kind: "patch", path, patch: macroFunction }],
      });
      assert.equal(result.status, "ok", JSON.stringify(result));
      assert.equal(
        (result.data as { parse: { status: string } }).parse.status,
        "unsupported",
      );
      assert.equal(await readFile(join(root, path), "utf8"), macroFunction);
      await execute(compiler!, ["-fsyntax-only", path], { cwd: root });
    });
  });
}

test("a C symbol replacement preserves valid macro content", async () => {
  await fixture(async (root, workspace) => {
    await writeFile(join(root, "value.c"), ordinaryFunction);
    await workspace.readCode({ target: "value.c#value" }, {});
    const result = await workspace.editCode({
      operations: [
        {
          kind: "symbol",
          target: "value.c#value",
          action: "replace",
          content: macroFunction,
        },
      ],
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    await execute("cc", ["-fsyntax-only", "value.c"], { cwd: root });
  });
});

test("invalid C remains unverified and the compiler reports the real failure", async () => {
  await fixture(async (root, workspace) => {
    const result = await workspace.editCode({
      operations: [
        {
          kind: "patch",
          path: "invalid.c",
          patch: "int value(void) { return ; + }\n",
        },
      ],
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.equal(
      (result.data as { parse: { status: string } }).parse.status,
      "unsupported",
    );
    await assert.rejects(
      execute("cc", ["-fsyntax-only", "invalid.c"], { cwd: root }),
    );
  });
});

test("a definite TypeScript syntax failure preserves atomicity beside an unverified C edit", async () => {
  await fixture(async (root, workspace) => {
    const result = await workspace.editCode({
      operations: [
        { kind: "patch", path: "value.c", patch: macroFunction },
        {
          kind: "patch",
          path: "invalid.ts",
          patch: "export const value = ;\n",
        },
      ],
    });
    assert.equal(result.status, "blocked", JSON.stringify(result));
    await assert.rejects(readFile(join(root, "value.c")), { code: "ENOENT" });
    await assert.rejects(readFile(join(root, "invalid.ts")), {
      code: "ENOENT",
    });
  });
});

async function fixture(
  run: (root: string, workspace: LightWorkspace) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-content-validation-"));
  try {
    await writeFile(join(root, "regions.h"), regionDefinitions);
    await run(
      root,
      new LightWorkspace(root, { sessionId: "content-validation" }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
