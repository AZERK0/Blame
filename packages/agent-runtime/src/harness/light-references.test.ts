import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LightWorkspace } from "./light-workspace.js";
import { sha256 } from "./light-identity.js";
import {
  querySemanticReferences,
  referenceFootprintIsCurrent,
} from "./semantic-reference-client.js";

const source =
  "export function calculate(n: number): number { return n + 1; }\n";
const files = {
  "original.ts": source,
  "consumer.ts":
    'import { calculate as compute } from "./original.js";\nexport function use() { return compute(4); }\n',
  "unrelated.ts":
    'export function calculate(n: number) { return n - 1; }\nexport const label = "calculate";\n// calculate\n',
};
const config = {
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    types: [],
  },
  include: ["*.ts", "*.js"],
};
function data(result: Awaited<ReturnType<LightWorkspace["searchCode"]>>) {
  assert.equal(result.status, "ok", JSON.stringify(result));
  return (result as { data: Record<string, unknown> }).data;
}
async function fixture(
  run: (workspace: LightWorkspace, root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "light-reference-"));
  try {
    for (const [path, text] of Object.entries(files))
      await writeFile(join(root, path), text);
    await writeFile(join(root, "package.json"), '{"type":"module"}');
    await writeFile(join(root, "tsconfig.json"), JSON.stringify(config));
    await run(
      new LightWorkspace(root, { sessionId: "semantic-references" }),
      root,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const references = (
  workspace: LightWorkspace,
  query = "original.ts#calculate",
  scope?: string,
) =>
  workspace.searchCode({
    query,
    mode: "references",
    ...(scope ? { scope } : {}),
  });

test("identity references follow an import alias and exclude unrelated homonyms/literals/comments", async () => {
  await fixture(async (workspace, root) => {
    const result = data(await references(workspace));
    assert.equal(result.engine, "typescript_language_service");
    assert.equal(result.referenceCount, 2);
    const hits = result.results as Array<{
      path: string;
      reference: { lines: number[] };
    }>;
    assert.deepEqual(
      hits.map((hit) => [hit.path, hit.reference.lines[0]]),
      [
        ["consumer.ts", 1],
        ["consumer.ts", 2],
      ],
    );
    assert.equal(result.completeness, "configured_project");
    assert.equal(
      (result.project as { compilerVersion: string }).compilerVersion,
      "5.9.3",
    );
    for (const [path, text] of Object.entries(files))
      assert.equal(await readFile(join(root, path), "utf8"), text);
  });
});

test("bare references remain honest lexical candidates; aliases identify the desired declaration", async () => {
  await fixture(async (workspace) => {
    const bare = data(await references(workspace, "calculate"));
    assert.equal(bare.engine, "lexical_fallback");
    assert.equal(bare.semanticFallback, "symbol_target_required");
    const symbol = data(
      await workspace.searchCode({
        query: "calculate",
        mode: "symbol",
        scope: "original.ts",
      }),
    );
    const alias = (symbol.results as Array<{ alias: string }>)[0]!.alias;
    assert.equal(data(await references(workspace, alias)).referenceCount, 2);
  });
});

test("scope filters returned references without changing the compiler project", async () => {
  await fixture(async (workspace) => {
    const result = data(
      await references(workspace, "original.ts#calculate", "unrelated.ts"),
    );
    assert.deepEqual(result.results, []);
    assert.equal(result.referenceCount, 0);
    assert.equal(result.limited, false);
    assert.equal((result.project as { rootFiles: number }).rootFiles, 3);
  });
});

test("reference discovery never grants unseen body-edit coverage", async () => {
  await fixture(async (workspace) => {
    await references(workspace);
    const result = await workspace.editCode({
      operations: [
        {
          kind: "symbol",
          target: "original.ts#calculate",
          action: "replace_body",
          content: "{ return n * 2; }",
        },
      ],
    });
    assert.equal(result.status, "blocked");
  });
});

test("external body changes remain protected after a semantic query refreshes symbol identity", async () => {
  await fixture(async (workspace, root) => {
    await workspace.readCode(
      { target: "original.ts#calculate", view: "symbol" },
      {},
    );
    await writeFile(
      join(root, "original.ts"),
      source.replace("n + 1", "n + 99"),
    );
    await references(workspace);
    const result = await workspace.editCode({
      operations: [
        {
          kind: "symbol",
          target: "original.ts#calculate",
          action: "replace_body",
          content: "{ return n * 2; }",
        },
      ],
    });
    assert.equal(result.status, "blocked");
    assert.match(await readFile(join(root, "original.ts"), "utf8"), /n \+ 99/u);
  });
});

test("fresh worker sees added references and changed project configuration", async () => {
  await fixture(async (workspace, root) => {
    assert.equal(data(await references(workspace)).referenceCount, 2);
    await writeFile(
      join(root, "added.ts"),
      'import { calculate } from "./original.js";\ncalculate(1);\n',
    );
    assert.equal(data(await references(workspace)).referenceCount, 4);
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ ...config, files: ["original.ts"], include: [] }),
    );
    assert.equal(data(await references(workspace)).referenceCount, 0);
  });
});

test("no or invalid config, and unsupported languages, expose labeled lexical fallback", async () => {
  await fixture(async (workspace, root) => {
    await rm(join(root, "tsconfig.json"));
    assert.equal(
      data(await references(workspace)).semanticFallback,
      "no_project_config",
    );
    await writeFile(
      join(root, "tsconfig.json"),
      '{"compilerOptions":{"target":"not-a-target"}}',
    );
    assert.equal(
      data(await references(workspace)).semanticFallback,
      "invalid_project_config",
    );
    await writeFile(
      join(root, "sample.py"),
      "def calculate(n):\n    return n + 1\n",
    );
    assert.equal(
      data(await references(workspace, "sample.py#calculate")).semanticFallback,
      "unsupported_language",
    );
  });
});

test("configured-project boundary rejects an excluded target", async () => {
  await fixture(async (workspace, root) => {
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ ...config, files: ["unrelated.ts"], include: [] }),
    );
    assert.equal(
      data(await references(workspace)).semanticFallback,
      "target_not_in_project",
    );
  });
});

test("missing imports report partial project, never full reference completeness", async () => {
  await fixture(async (workspace, root) => {
    await writeFile(
      join(root, "missing.ts"),
      'import { value } from "./absent.js";\nexport { value };\n',
    );
    const result = data(await references(workspace));
    assert.equal(result.engine, "typescript_language_service");
    assert.equal(result.completeness, "partial_project");
    assert.ok(
      (result.project as { warnings: string[] }).warnings.includes(
        "unresolved_imports",
      ),
    );
  });
});

test("result limits remain visible and narrowing finds later references", async () => {
  await fixture(async (workspace, root) => {
    for (let index = 0; index < 10; index++)
      await writeFile(
        join(root, `use-${index}.ts`),
        'import { calculate } from "./original.js";\ncalculate(1);\n',
      );
    const result = data(await references(workspace));
    assert.equal((result.results as unknown[]).length, 8);
    assert.equal(result.referenceCount, 22);
    assert.equal(result.limited, true);
    assert.equal(
      data(await references(workspace, "original.ts#calculate", "use-9.ts"))
        .referenceCount,
      2,
    );
  });
});

test("UTF-8/BOM and non-ASCII prefix preserve compiler-to-byte offsets", async () => {
  await fixture(async (workspace, root) => {
    await writeFile(join(root, "original.ts"), "\uFEFF// café 😀\n" + source);
    await writeFile(
      join(root, "consumer.ts"),
      '// café 😀\nimport { calculate as compute } from "./original.js";\ncompute(4);\n',
    );
    const result = data(await references(workspace));
    assert.deepEqual(
      (result.results as Array<{ reference: { lines: number[] } }>).map(
        (hit) => hit.reference.lines[0],
      ),
      [2, 3],
    );
  });
});

test("method identity follows class import aliases through re-exports", async () => {
  await fixture(async (workspace, root) => {
    await writeFile(
      join(root, "original.ts"),
      "export class Counter { calculate(n: number) { return n + 1; } }\n",
    );
    await writeFile(
      join(root, "barrel.ts"),
      'export { Counter as WrappedCounter } from "./original.js";\n',
    );
    await writeFile(
      join(root, "consumer.ts"),
      'import { WrappedCounter as C } from "./barrel.js";\nexport const result = new C().calculate(4);\n',
    );
    const result = data(
      await references(workspace, "original.ts#Counter.calculate"),
    );
    assert.equal(result.engine, "typescript_language_service");
    assert.deepEqual(
      (
        result.results as Array<{
          path: string;
          reference: { lines: number[] };
        }>
      ).map((hit) => [hit.path, hit.reference.lines[0]]),
      [["consumer.ts", 2]],
    );
  });
});

test("JavaScript jsconfig project uses the same read-only identity mechanism", async () => {
  await fixture(async (workspace, root) => {
    await rm(join(root, "tsconfig.json"));
    await writeFile(
      join(root, "jsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          allowJs: true,
          checkJs: true,
          noEmit: true,
          types: [],
        },
        include: ["*.js"],
      }),
    );
    await writeFile(
      join(root, "script.js"),
      "export function calculate(n) { return n + 1; }\n",
    );
    await writeFile(
      join(root, "use.js"),
      'import { calculate as compute } from "./script.js";\ncompute(1);\n',
    );
    const result = data(await references(workspace, "script.js#calculate"));
    assert.equal(result.engine, "typescript_language_service");
    assert.equal(result.referenceCount, 2);
  });
});

test("project references are labeled and a navigation result is not validation proof", async () => {
  await fixture(async (workspace, root) => {
    await mkdir(join(root, "child"));
    await writeFile(
      join(root, "child/tsconfig.json"),
      JSON.stringify({ compilerOptions: { composite: true }, files: [] }),
    );
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({ ...config, references: [{ path: "./child" }] }),
    );
    const result = data(await references(workspace));
    assert.equal(result.navigationOnly, true);
    assert.equal(result.completeness, "partial_project");
    assert.ok(
      (result.project as { warnings: string[] }).warnings.includes(
        "project_references_not_fully_expanded",
      ),
    );
  });
});

test("footprint freshness checks content and negative file lookups including directories", async () => {
  await fixture(async (_workspace, root) => {
    const path = join(root, "original.ts"),
      absent = join(root, "absent.ts"),
      folder = join(root, "directory.ts");
    await mkdir(folder);
    const footprint = {
      reads: [{ path, hash: sha256(source) }],
      existence: [
        { path: absent, exists: false },
        { path: folder, exists: false },
      ],
    };
    assert.equal(await referenceFootprintIsCurrent(footprint), true);
    await writeFile(absent, "export {};");
    assert.equal(await referenceFootprintIsCurrent(footprint), false);
    await rm(absent);
    await writeFile(path, source.replace("n + 1", "n + 99"));
    assert.equal(await referenceFootprintIsCurrent(footprint), false);
  });
});

test("reference worker has an outer timeout and cancellation releases it", async () => {
  await fixture(async (_workspace, root) => {
    const request = {
      root,
      target: {
        path: "original.ts",
        name: "calculate",
        start: 0,
        end: source.length,
        hash: sha256(source),
      },
    };
    assert.deepEqual(await querySemanticReferences(request, undefined, 1), {
      status: "unavailable",
      reason: "query_timeout",
    });
    const aborted = AbortSignal.abort(new Error("cancelled before dispatch"));
    await assert.rejects(
      querySemanticReferences(request, aborted),
      /cancelled before/u,
    );
    const controller = new AbortController();
    const pending = querySemanticReferences(request, controller.signal);
    controller.abort(new Error("cancelled during dispatch"));
    await assert.rejects(pending, /cancelled during/u);
  });
});
