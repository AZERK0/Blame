import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  capabilityParseAvailability,
  lightCapabilityDescription,
} from "./light-capabilities.js";
import { LightCommitService } from "./light-commit.js";
import type { LightToolResult } from "./light-contracts.js";
import { alignDependencyPackages } from "./light-dependencies.js";
import { executeLightWorkspaceRequest } from "./light-executor.js";
import { lightSemanticHarnessTools } from "./light-tools.js";
import { LightWorkspace } from "./light-workspace.js";
import { createFinishTaskTool } from "./finish-task.js";
import { createInitialTaskBriefing } from "./initial-task-briefing.js";
import { SessionJournal } from "./session-journal.js";
import { WorkspaceFiles } from "./workspace-files.js";

test("runtime capabilities include loaded C, C++, HTML, and application adapters", () => {
  const description = lightCapabilityDescription();
  for (const extension of [
    ".c",
    ".cpp",
    ".cs",
    ".go",
    ".html",
    ".java",
    ".py",
    ".rs",
    ".tsx",
  ])
    assert.match(description, new RegExp(`\\${extension}`));
});

test("an unloaded parser reports unavailable and never passed", () => {
  assert.equal(capabilityParseAvailability({ loaded: false }), "unavailable");
  assert.equal(capabilityParseAvailability(), "unsupported");
});

const symbolLanguageCases = [
  [
    "sample.ts",
    "export function sample() { return 1 }\n",
    "sample",
    "{ return 2 }",
  ],
  [
    "sample.mts",
    "export function sample() { return 1 }\n",
    "sample",
    "{ return 2 }",
  ],
  [
    "sample.cts",
    "export function sample() { return 1 }\n",
    "sample",
    "{ return 2 }",
  ],
  [
    "sample.tsx",
    "export function Sample() { return <div /> }\n",
    "Sample",
    "{ return <span /> }",
  ],
  [
    "sample.js",
    "export function sample() { return 1 }\n",
    "sample",
    "{ return 2 }",
  ],
  [
    "sample.mjs",
    "export function sample() { return 1 }\n",
    "sample",
    "{ return 2 }",
  ],
  ["sample.cjs", "function sample() { return 1 }\n", "sample", "{ return 2 }"],
  [
    "sample.jsx",
    "export function Sample() { return <div /> }\n",
    "Sample",
    "{ return <span /> }",
  ],
  ["sample.py", "def sample():\n    return 1\n", "sample", "return 2"],
  ["sample.rs", "fn sample() -> i32 { 1 }\n", "sample", "{ 2 }"],
  [
    "sample.go",
    "package sample\nfunc Sample() int { return 1 }\n",
    "Sample",
    "{ return 2 }",
  ],
  [
    "Sample.java",
    "class Sample { int value() { return 1; } }\n",
    "value",
    "{ return 2; }",
  ],
  [
    "Sample.cs",
    "class Sample { int Value() { return 1; } }\n",
    "Value",
    "{ return 2; }",
  ],
  ["sample.c", "int sample(void) { return 1; }\n", "sample", "{ return 2; }"],
  [
    "sample.h",
    "static int sample(void) { return 1; }\n",
    "sample",
    "{ return 2; }",
  ],
  ["sample.cpp", "int sample() { return 1; }\n", "sample", "{ return 2; }"],
  ["sample.cc", "int sample() { return 1; }\n", "sample", "{ return 2; }"],
  ["sample.cxx", "int sample() { return 1; }\n", "sample", "{ return 2; }"],
  [
    "sample.hpp",
    "inline int sample() { return 1; }\n",
    "sample",
    "{ return 2; }",
  ],
] as const;

for (const [path, source, query, replacement] of symbolLanguageCases)
  test(`symbol read and body edit execute for ${path}`, async () => {
    await withWorkspace({ [path]: source }, async (root) => {
      const workspace = lightWorkspace(root, `language-${path}`);
      const alias = await symbolAlias(workspace, query);
      const symbol = data(
        await workspace.readCode(
          { target: alias, view: "symbol" },
          { agentId: "lead" },
        ),
      );
      assert.match(String(symbol.signature), new RegExp(query, "u"));
      assert.ok(String(symbol.body));
      const result = await workspace.editCode({
        operations: [
          {
            action: "replace_body",
            content: replacement,
            kind: "symbol",
            target: alias,
          },
        ],
      });
      assert.equal(result.status, "ok");
      assert.equal(record(data(result).parse).status, "passed");
      assert.match(
        await readFile(join(root, path), "utf8"),
        replacement.includes("span") ? /span/u : /2/u,
      );
    });
  });

test("tool surface contains only the four workspace tools", async () => {
  await withWorkspace(
    { "src/app.ts": "export const value = 1\n" },
    async (root) => {
      const names = lightSemanticHarnessTools(root, {
        taskContract: contract("surface"),
      }).map(({ name }) => name);
      assert.deepEqual(names, [
        "search_code",
        "read_code",
        "edit_code",
        "run_task",
      ]);
    },
  );
});

test("auto search combines lexical matches and supports multi-term glob scopes", async () => {
  await withWorkspace(
    {
      "package.json": JSON.stringify(
        { name: "root-package", scripts: { build: "tsc" } },
        null,
        2,
      ),
      "packages/web/package.json": JSON.stringify(
        { name: "web-package", scripts: { test: "node --test" } },
        null,
        2,
      ),
      "src/scripts.ts": "export function scripts() { return 'code' }\n",
    },
    async (root) => {
      const workspace = lightWorkspace(root, "search-routing");
      const global = data(await workspace.searchCode({ query: "scripts" }));
      assert.ok(
        array(global.results).some(
          (value) => record(value).path === "package.json",
        ),
      );
      assert.ok(
        array(global.results).some(
          (value) => record(value).qualifiedName === "scripts",
        ),
      );
      const scoped = data(
        await workspace.searchCode({
          query: "scripts",
          scope: ["**/package.json"],
        }),
      );
      assert.equal(scoped.mode, "auto");
      assert.deepEqual(
        new Set(array(scoped.results).map((value) => record(value).path)),
        new Set(["package.json", "packages/web/package.json"]),
      );
      const terms = data(
        await workspace.searchCode({
          query: "scripts package",
          scope: "**/package.json",
        }),
      );
      assert.ok(array(terms.results).length > 0);
      assert.ok(
        array(terms.results).every((value) =>
          String(record(value).path).endsWith("package.json"),
        ),
      );
    },
  );
});

test("small raw reads deduplicate by emitted bytes without invalidating other files", async () => {
  await withWorkspace(
    { "a.ts": "export const a = 1\n", "b.ts": "export const b = 2\n" },
    async (root) => {
      const workspace = lightWorkspace(root, "coverage");
      const context = { agentId: "lead" };
      assert.equal(
        data(await workspace.readCode({ target: "a.ts" }, context)).view,
        "raw",
      );
      await workspace.readCode({ target: "b.ts" }, context);
      assert.equal(
        data(await workspace.readCode({ target: "a.ts" }, context)).status,
        "already_in_context",
      );
      await workspace.edits.edit(
        {
          operations: [
            {
              kind: "patch",
              path: "a.ts",
              patch: applyPatch("a.ts", [
                "-export const a = 1",
                "+export const a = 3",
              ]),
            },
          ],
        },
        { sessionId: "coverage", toolCallId: "edit-a" },
      );
      assert.equal(
        data(await workspace.readCode({ target: "b.ts" }, context)).status,
        "already_in_context",
      );
      assert.match(
        String(
          data(await workspace.readCode({ target: "a.ts" }, context)).content,
        ),
        /a = 3/u,
      );
    },
  );
});

test("read coverage survives isolated Light bridge executions", async () => {
  await withWorkspace(
    { "value.ts": "export const value = 1\n" },
    async (root) => {
      const request = {
        input: { target: "value.ts" },
        taskContract: { session_id: "remote-coverage" },
        tool: "read_code" as const,
        toolContext: { agentId: "lead" },
        workspaceRoot: root,
      };
      assert.equal(
        data(await executeLightWorkspaceRequest(request)).view,
        "raw",
      );
      assert.equal(
        data(await executeLightWorkspaceRequest(request)).status,
        "already_in_context",
      );
    },
  );
});

test("an unavailable package manager is reported without mutating manifests", async () => {
  const manifest = `${JSON.stringify({
    name: "unavailable-manager",
    packageManager: "pnpm@999.0.0",
  })}\n`;
  await withWorkspace({ "package.json": manifest }, async (root) => {
    const briefing = await createInitialTaskBriefing({ workspaceRoot: root });
    assert.match(
      briefing ?? "",
      /Package manager: pnpm; executable unavailable/u,
    );
    const workspace = lightWorkspace(root, "dependency-failure");
    const result = await workspace.tasks.run({
      action: "add",
      kind: "dependency",
      packages: ["example-package"],
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked")
      assert.equal(result.category, "environment");
    assert.equal(await readFile(join(root, "package.json"), "utf8"), manifest);
  });
});

test("the briefing exposes package topology, key files, and stack versions", async () => {
  await withWorkspace(
    {
      "package.json": JSON.stringify({
        name: "workspace",
        scripts: { build: "tsc", test: "node --test" },
        dependencies: { "@prisma/client": "7.9.1" },
      }),
      "packages/api/package.json": JSON.stringify({
        name: "api",
        scripts: { dev: "node src/server.js" },
      }),
      "packages/api/src/server.ts": "export const server = true\n",
      "prisma/schema.prisma": "model User {\n  id Int @id\n}\n",
      "tsconfig.json": "{}\n",
    },
    async (root) => {
      const briefing = await createInitialTaskBriefing({
        workspaceRoot: root,
        taskContract: {
          ...contract("briefing-map"),
          objective: "Update the API server",
        },
      });
      assert.match(briefing ?? "", /Project map: packages \(/u);
      assert.match(briefing ?? "", /prisma\/schema\.prisma/u);
      assert.match(briefing ?? "", /@prisma\/client@7\.9\.1/u);
      assert.match(briefing ?? "", /scripts build,test/u);
      assert.match(briefing ?? "", /packages\/api\/src\/server\.ts#server/u);
      assert.doesNotMatch(briefing ?? "", /scripts dev/u);
      assert.match(briefing ?? "", /must not be started manually/u);
      assert.match(briefing ?? "", /node_modules/u);
      assert.ok((briefing?.length ?? Infinity) < 6_000);
    },
  );
});

test("Prisma family additions align with the installed client version", () => {
  const packages = alignDependencyPackages(
    ["@prisma/adapter-pg", "@prisma/client@7.10.0", "zod"],
    { dependencies: { "@prisma/client": "^7.9.1" } },
  );
  assert.deepEqual(packages, [
    "@prisma/adapter-pg@7.9.1",
    "@prisma/client@7.10.0",
    "zod",
  ]);
});

test("run_task preserves pipeline failures and complete diagnostics", async () => {
  await withWorkspace({ "package.json": "{}\n" }, async (root) => {
    const workspace = lightWorkspace(root, "pipeline-diagnostic");
    const result = await workspace.tasks.run({
      kind: "command",
      command:
        "node -e \"console.error('diagnostic start'); console.error('fatal detail'); process.exit(7)\" 2>&1 | cat",
    });
    assert.equal(result.status, "blocked");
    if (result.status !== "blocked") return;
    assert.equal(result.category, "code");
    assert.match(result.message, /code 7/u);
    assert.match(result.message, /diagnostic start/u);
    assert.match(result.message, /fatal detail/u);
  });
});

test("run_task classifies a missing declared dependency as environment", async () => {
  const manifest = JSON.stringify({
    dependencies: { "@prisma/client": "7.9.1" },
  });
  await withWorkspace({ "package.json": manifest }, async (root) => {
    const workspace = lightWorkspace(root, "dependency-diagnostic");
    const result = await workspace.tasks.run({
      kind: "command",
      command:
        'node -e "console.error(\\"Cannot find module \'@prisma/client\'\\"); process.exit(1)"',
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked")
      assert.equal(result.category, "environment");
  });
});

test("run_task classifies infrastructure and storage failures as environment", async () => {
  await withWorkspace({ "package.json": "{}\n" }, async (root) => {
    const workspace = lightWorkspace(root, "environment-diagnostics");
    for (const diagnostic of [
      "P1001: Can't reach database server",
      "ENOSPC: no space left on device",
      "Managed preview unavailable",
    ]) {
      const result = await workspace.tasks.run({
        kind: "command",
        command: `node -e "console.error(process.argv[1]); process.exit(1)" ${JSON.stringify(diagnostic)}`,
      });
      assert.equal(result.status, "blocked");
      if (result.status !== "blocked") continue;
      assert.equal(result.category, "environment");
      assert.match(result.recovery ?? "", /Do not retry unchanged/u);
    }
  });
});

test("run_task denies shell writes and unmanaged infrastructure", async () => {
  await withWorkspace({ "value.txt": "safe\n" }, async (root) => {
    const workspace = lightWorkspace(root, "command-policy");
    for (const command of [
      "printf unsafe > value.txt",
      "cp value.txt copy.txt",
      "sed -i s/safe/unsafe/ value.txt",
      "node -e \"require('node:fs').writeFileSync('value.txt', 'unsafe')\"",
      "pnpm install",
      "git add value.txt",
      "git -C . add value.txt",
      "docker run postgres:17",
    ]) {
      const result = await workspace.tasks.run({ kind: "command", command });
      assert.equal(result.status, "blocked");
      if (result.status === "blocked") assert.equal(result.category, "input");
    }
    assert.equal(await readFile(join(root, "value.txt"), "utf8"), "safe\n");
  });
});

test("run_task reuses identical inspections and rejects service scripts", async () => {
  await withWorkspace(
    {
      "package.json": JSON.stringify({
        scripts: {
          dev: "next dev",
          preview: "vite preview",
          test: 'node -e "process.exit(0)"',
        },
      }),
    },
    async (root) => {
      const workspace = lightWorkspace(root, "task-reuse");
      const first = data(
        await workspace.tasks.run({ kind: "command", command: "pwd" }),
      );
      const second = data(
        await workspace.tasks.run({ kind: "command", command: "pwd" }),
      );
      assert.equal(first.cached, undefined);
      assert.equal(second.cached, true);
      await workspace.tasks.run({ kind: "project", task: "test" });
      const validation = data(
        await workspace.tasks.run({ kind: "project", task: "test" }),
      );
      assert.equal(validation.cached, true);
      const service = await workspace.tasks.run({
        kind: "project",
        task: "dev",
      });
      assert.equal(service.status, "blocked");
      if (service.status !== "blocked") return;
      assert.equal(service.category, "environment");
      assert.match(service.recovery ?? "", /Do not start a replacement/u);
      const preview = await workspace.tasks.run({
        kind: "project",
        task: "preview",
      });
      assert.equal(preview.status, "blocked");
    },
  );
});

test("run_task reuse survives isolated Light bridge executions", async () => {
  await withWorkspace({ "package.json": "{}\n" }, async (root) => {
    const request = {
      input: { kind: "command" as const, command: "pwd" },
      taskContract: contract("remote-task-reuse"),
      tool: "run_task" as const,
      workspaceRoot: root,
    };
    const first = data(await executeLightWorkspaceRequest(request));
    const second = data(await executeLightWorkspaceRequest(request));
    assert.equal(first.cached, undefined);
    assert.equal(second.cached, true);
  });
});

test("run_task does not repeat a failed command at one source revision", async () => {
  await withWorkspace({ "package.json": "{}\n" }, async (root) => {
    const workspace = lightWorkspace(root, "failed-task-reuse");
    const command = "node -e \"console.error('failure'); process.exit(3)\"";
    const first = await workspace.tasks.run({ kind: "command", command });
    const second = await workspace.tasks.run({ kind: "command", command });
    assert.equal(first.status, "blocked");
    assert.equal(second.status, "blocked");
    if (second.status !== "blocked") return;
    assert.match(second.message, /already failed/u);
  });
});

test("run_task permits environment validation after external recovery", async () => {
  const manifest = JSON.stringify({
    scripts: {
      test: "node -e \"console.error('P1001: cannot connect'); process.exit(1)\"",
    },
  });
  await withWorkspace({ "package.json": manifest }, async (root) => {
    const workspace = lightWorkspace(root, "environment-task-retry");
    await workspace.tasks.run({ kind: "project", task: "test" });
    const retried = await workspace.tasks.run({
      kind: "project",
      task: "test",
    });
    assert.equal(retried.status, "blocked");
    if (retried.status !== "blocked") return;
    assert.match(retried.message, /Command exited/u);
    assert.doesNotMatch(retried.message, /already failed/u);
  });
});

test("run_task bounds successful command output", async () => {
  await withWorkspace({ "package.json": "{}\n" }, async (root) => {
    const workspace = lightWorkspace(root, "bounded-success");
    const result = data(
      await workspace.tasks.run({
        kind: "command",
        command: `node -e "console.log('x'.repeat(10000))"`,
      }),
    );
    assert.ok(String(result.output).length <= 4_000);
    assert.match(String(result.output), /diagnostic truncated/u);
  });
});

test("large application files route through outline and symbol reads", async () => {
  const filler = Array.from(
    { length: 1_500 },
    (_, index) => `export const value${index} = ${index}`,
  ).join("\n");
  const source = `export function target() { return 1 }\n${filler}\n`;
  await withWorkspace({ "large.ts": source }, async (root) => {
    const workspace = lightWorkspace(root, "large");
    const outline = data(
      await workspace.readCode({ target: "large.ts" }, { agentId: "lead" }),
    );
    assert.equal(outline.view, "outline");
    const item = record(
      array(outline.items).find(
        (value) => record(value).qualified_name === "target",
      ),
    );
    const symbol = data(
      await workspace.readCode(
        { target: String(item.alias), view: "symbol" },
        { agentId: "lead" },
      ),
    );
    assert.equal(symbol.qualifiedName, "target");
    assert.match(String(symbol.body), /return 1/u);
  });
});

test("medium supported files route through an outline", async () => {
  const source = Array.from(
    { length: 400 },
    (_, index) => `export const mediumValue${index} = ${index}`,
  ).join("\n");
  await withWorkspace({ "medium.ts": `${source}\n` }, async (root) => {
    const workspace = lightWorkspace(root, "medium-outline");
    const result = data(
      await workspace.readCode({ target: "medium.ts" }, { agentId: "lead" }),
    );
    assert.equal(result.view, "outline");
  });
});

test("raw formats fall back in the same read call", async () => {
  await withWorkspace(
    {
      "schema.prisma": "model User {\n  id Int @id\n}\n",
      "settings.json": '{"value":true}\n',
      "settings.rare": "value=true\n",
    },
    async (root) => {
      const workspace = lightWorkspace(root, "raw");
      for (const path of ["schema.prisma", "settings.json", "settings.rare"]) {
        const result = data(
          await workspace.readCode(
            { target: path, view: "symbol" },
            { agentId: "lead" },
          ),
        );
        assert.equal(result.view, "raw");
        assert.equal(result.fallbackReason, "symbol_target_missing");
      }
    },
  );
});

test("CSS supports structural outline and rule body editing", async () => {
  await withWorkspace(
    { "styles.css": ".card { color: red; }\n" },
    async (root) => {
      const workspace = lightWorkspace(root, "css-structure");
      const outline = data(
        await workspace.readCode(
          { target: "styles.css", view: "outline" },
          { agentId: "lead" },
        ),
      );
      const rule = record(array(outline.items)[0]);
      const result = await workspace.editCode({
        operations: [
          {
            action: "replace_body",
            content: "{ color: blue; }",
            kind: "symbol",
            target: String(rule.alias),
          },
        ],
      });
      assert.equal(result.status, "ok");
      assert.equal(
        await readFile(join(root, "styles.css"), "utf8"),
        ".card { color: blue; }\n",
      );
    },
  );
});

test("one batch combines an import patch and a symbol body replacement", async () => {
  const source =
    "import { value } from './value.js'\n\nexport function greet() {\n  return value\n}\n";
  await withWorkspace({ "src/app.ts": source }, async (root) => {
    const workspace = lightWorkspace(root, "hybrid");
    const alias = await symbolAlias(workspace, "greet");
    const result = await workspace.edits.edit(
      {
        operations: [
          {
            kind: "patch",
            path: "src/app.ts",
            patch: applyPatch("ignored.ts", [
              "-import { value } from './value.js'",
              "+import { value as helper } from './value.js'",
            ]),
          },
          {
            kind: "symbol",
            target: alias,
            action: "replace_body",
            content: "{\n  return helper()\n}",
          },
        ],
      },
      { sessionId: "hybrid", toolCallId: "edit-hybrid" },
    );
    assert.equal(result.status, "ok");
    assert.equal(record(data(result).parse).status, "passed");
    assert.equal(
      await readFile(join(root, "src/app.ts"), "utf8"),
      "import { value as helper } from './value.js'\n\nexport function greet() {\n  return helper()\n}\n",
    );
  });
});

test("HTML supports outline and structural body replacement", async () => {
  await withWorkspace(
    { "index.html": '<main id="app"><p>Hello</p></main>\n' },
    async (root) => {
      const workspace = lightWorkspace(root, "html");
      const outline = data(
        await workspace.readCode(
          { target: "index.html", view: "outline" },
          { agentId: "lead" },
        ),
      );
      assert.equal(outline.view, "outline");
      const main = record(
        array(outline.items).find(
          (value) => record(value).qualified_name === "main#app",
        ),
      );
      const result = await workspace.edits.edit(
        {
          operations: [
            {
              kind: "symbol",
              target: String(main.alias),
              action: "replace_body",
              content: "<p>World</p>",
            },
          ],
        },
        { sessionId: "html", toolCallId: "edit-html" },
      );
      assert.equal(result.status, "ok");
      assert.equal(
        await readFile(join(root, "index.html"), "utf8"),
        '<main id="app"><p>World</p></main>\n',
      );
    },
  );
});

for (const extension of ["vue", "svelte"])
  test(`${extension} supports structural outline and element editing`, async () => {
    const path = `Component.${extension}`;
    const source = '<main id="app"><p>Hello</p></main>\n';
    await withWorkspace({ [path]: source }, async (root) => {
      const workspace = lightWorkspace(root, `structure-${extension}`);
      const outline = data(
        await workspace.readCode(
          { target: path, view: "outline" },
          { agentId: "lead" },
        ),
      );
      const main = record(
        array(outline.items).find(
          (value) => record(value).qualified_name === "main#app",
        ),
      );
      const result = await workspace.editCode({
        operations: [
          {
            action: "replace_body",
            content: "<p>World</p>",
            kind: "symbol",
            target: String(main.alias),
          },
        ],
      });
      assert.equal(result.status, "ok");
      assert.match(await readFile(join(root, path), "utf8"), /World/u);
    });
  });

test("symbol insertion and Prisma patching share one atomic batch", async () => {
  await withWorkspace(
    {
      "service.ts": "export function first() { return 1 }\n",
      "schema.prisma": "model User {\n  id Int @id\n}\n",
    },
    async (root) => {
      const workspace = lightWorkspace(root, "mixed-insert");
      const alias = await symbolAlias(workspace, "first");
      const result = await workspace.editCode({
        operations: [
          {
            action: "insert_after",
            content: "\nexport function second() { return 2 }",
            kind: "symbol",
            target: alias,
          },
          {
            kind: "patch",
            path: "schema.prisma",
            patch: applyPatch("ignored.prisma", [
              " model User {",
              "   id Int @id",
              "+  name String",
              " }",
            ]),
          },
        ],
      });
      assert.equal(result.status, "ok");
      assert.equal(record(data(result).parse).status, "unsupported");
      assert.match(await readFile(join(root, "service.ts"), "utf8"), /second/u);
      assert.match(
        await readFile(join(root, "schema.prisma"), "utf8"),
        /name String/u,
      );
    },
  );
});

test("symbol replace, insert before, insert after, and delete share one snapshot", async () => {
  const source = [
    "export function first() { return 1 }",
    "export function middle() { return 2 }",
    "export function last() { return 3 }",
    "",
  ].join("\n");
  await withWorkspace({ "actions.ts": source }, async (root) => {
    const workspace = lightWorkspace(root, "symbol-actions");
    const first = await symbolAlias(workspace, "first");
    const middle = await symbolAlias(workspace, "middle");
    const last = await symbolAlias(workspace, "last");
    const result = await workspace.editCode({
      operations: [
        {
          action: "insert_before",
          content: "export const before = 0\n",
          kind: "symbol",
          target: first,
        },
        {
          action: "replace",
          content: "export function middle() { return 20 }",
          kind: "symbol",
          target: middle,
        },
        {
          action: "insert_after",
          content: "\nexport const after = 4",
          kind: "symbol",
          target: last,
        },
        { action: "delete", kind: "symbol", target: last },
      ],
    });
    assert.equal(result.status, "ok");
    const content = await readFile(join(root, "actions.ts"), "utf8");
    assert.match(content, /before = 0/u);
    assert.match(content, /return 20/u);
    assert.match(content, /after = 4/u);
    assert.doesNotMatch(content, /return 3/u);
  });
});

test("preexisting parse errors may not increase", async () => {
  const source = "export function broken( {\nexport const value = 1\n";
  await withWorkspace({ "broken.ts": source }, async (root) => {
    const workspace = lightWorkspace(root, "degraded-parse");
    const result = await workspace.editCode({
      operations: [
        {
          kind: "patch",
          path: "broken.ts",
          patch: applyPatch("broken.ts", [
            "-export const value = 1",
            "+export const value = 2",
          ]),
        },
      ],
    });
    assert.equal(result.status, "ok");
    assert.equal(
      record(data(result).parse).status,
      "degraded_preexisting_errors",
    );
  });
});

test("ambiguous patch context is refused without fuzzy recovery", async () => {
  const source = "same\nsame\n";
  await withWorkspace({ "duplicate.txt": source }, async (root) => {
    const workspace = lightWorkspace(root, "ambiguous-patch");
    const result = await workspace.editCode({
      operations: [
        {
          kind: "patch",
          path: "duplicate.txt",
          patch: applyPatch("duplicate.txt", ["-same", "+changed"]),
        },
      ],
    });
    assert.equal(result.status, "blocked");
    if (result.status === "blocked")
      assert.match(result.recovery ?? "", /Do not resend the same patch/u);
    assert.equal(await readFile(join(root, "duplicate.txt"), "utf8"), source);
  });
});

test("aliases survive workspace reload and ambiguous relocation never writes", async () => {
  const source = "export function target() { return 1 }\n";
  await withWorkspace({ "target.ts": source }, async (root) => {
    const first = lightWorkspace(root, "persisted-alias");
    const alias = await symbolAlias(first, "target");
    const second = lightWorkspace(root, "persisted-alias");
    await second.readCode({ target: "@changes" }, { agentId: "lead" });
    await writeFile(join(root, "target.ts"), `${source}${source}`);
    const result = await second.editCode({
      operations: [
        {
          action: "replace_body",
          content: "{ return 2 }",
          kind: "symbol",
          target: alias,
        },
      ],
    });
    assert.equal(result.status, "blocked");
    assert.equal(
      await readFile(join(root, "target.ts"), "utf8"),
      `${source}${source}`,
    );
  });
});

test("real Cline compaction metadata enables one fresh hydration", async () => {
  await withWorkspace(
    { "value.ts": "export const value = 1\n" },
    async (root) => {
      const workspace = lightWorkspace(root, "compaction-coverage");
      const initial = { agentId: "lead" };
      await workspace.readCode({ target: "value.ts" }, initial);
      assert.equal(
        data(await workspace.readCode({ target: "value.ts" }, initial)).status,
        "already_in_context",
      );
      const compacted = {
        agentId: "lead",
        snapshot: {
          messages: [
            { id: "summary-1", metadata: { kind: "compaction_summary" } },
          ],
        },
      } as never;
      assert.match(
        String(
          data(await workspace.readCode({ target: "value.ts" }, compacted))
            .content,
        ),
        /value = 1/u,
      );
      assert.equal(
        data(await workspace.readCode({ target: "value.ts" }, compacted))
          .status,
        "already_in_context",
      );
    },
  );
});

test("finish_task reads the session journal and emits only a natural summary", async () => {
  await withWorkspace(
    { "value.ts": "export const value = 1\n" },
    async (root) => {
      const sessionId = "light-finish";
      const taskContract = contract(sessionId);
      const workspace = lightWorkspace(root, sessionId);
      await workspace.editCode({
        operations: [
          {
            kind: "patch",
            path: "value.ts",
            patch: applyPatch("value.ts", [
              "-export const value = 1",
              "+export const value = 2",
            ]),
          },
        ],
      });
      let notified = false;
      const tool = createFinishTaskTool({
        conversationId: sessionId,
        onComplete: () => {
          notified = true;
        },
        taskContract,
        workspaceRoot: root,
      });
      const result = await tool.execute(
        { summary: "Updated the value." },
        {
          agentId: "lead",
          iteration: 1,
          runId: "run",
          sessionId,
          toolCallId: "finish",
        },
      );
      assert.equal(result, "Updated the value.");
      assert.equal(notified, true);
      const journal = new SessionJournal(root, sessionId);
      await journal.hydrate();
      assert.equal(journal.currentChanges().length, 1);
    },
  );
});

test("remote finish_task forwards automatic validation activities", async () => {
  await withWorkspace(
    {
      "package.json": JSON.stringify({ scripts: { test: "node --version" } }),
      "value.ts": "export const value = 1\n",
    },
    async (root) => {
      const sessionId = "remote-finish";
      const taskContract = contract(sessionId);
      const workspace = lightWorkspace(root, sessionId);
      await workspace.editCode({
        operations: [
          {
            kind: "patch",
            path: "value.ts",
            patch: applyPatch("value.ts", [
              "-export const value = 1",
              "+export const value = 2",
            ]),
          },
        ],
      });
      const phases: string[] = [];
      const tool = createFinishTaskTool({
        conversationId: sessionId,
        executor: executeLightWorkspaceRequest,
        onValidationActivity: ({ phase }) => {
          phases.push(phase);
        },
        taskContract,
        workspaceRoot: root,
      });
      await tool.execute({ summary: "Updated remotely." }, {
        sessionId,
        toolCallId: "remote-finish",
      } as never);
      assert.deepEqual(phases, ["started", "finished"]);
    },
  );
});

test("content changes invalidate journal validations", async () => {
  await withWorkspace(
    { "value.ts": "export const value = 1\n" },
    async (root) => {
      const journal = new SessionJournal(root, "validation-freshness");
      const sourceRevisionId = (await new WorkspaceFiles(root).snapshot())
        .revision.source_revision_id;
      await journal.recordChange({
        parse: "passed",
        paths: ["value.ts"],
        receipt: "e1",
        sourceRevisionId,
        symbols: [],
      });
      await journal.recordValidation({
        command: "test",
        paths: ["value.ts"],
        sourceRevisionId,
        status: "passed",
      });
      assert.equal((await journal.completionSnapshot()).validations.length, 1);
      await writeFile(join(root, "value.ts"), "export const value = 2\n");
      assert.equal((await journal.completionSnapshot()).validations.length, 0);
    },
  );
});

test("one native Cline patch edits multiple files atomically", async () => {
  await withWorkspace(
    {
      "a.ts": "export const a = 1\n",
      "b.ts": "export const b = 2\n",
    },
    async (root) => {
      const workspace = lightWorkspace(root, "multi-file-patch");
      const result = await workspace.editCode({
        operations: [
          {
            kind: "patch",
            patch: multiFilePatch([
              [
                "*** Update File: a.ts",
                "@@",
                "-export const a = 1",
                "+export const a = 3",
              ],
              [
                "*** Update File: b.ts",
                "@@",
                "-export const b = 2",
                "+export const b = 4",
              ],
            ]),
          },
        ],
      });
      assert.equal(result.status, "ok");
      const changes = array(data(result).changes).map(record);
      assert.deepEqual(
        changes.map(({ symbols }) => symbols),
        [["a"], ["b"]],
      );
      assert.equal(
        await readFile(join(root, "a.ts"), "utf8"),
        "export const a = 3\n",
      );
      assert.equal(
        await readFile(join(root, "b.ts"), "utf8"),
        "export const b = 4\n",
      );
    },
  );
});

test("overlaps and final parse failures leave every file unchanged", async () => {
  const initial = {
    "a.ts": "export function a() { return 1 }\n",
    "b.ts": "export function b() { return 2 }\n",
  };
  await withWorkspace(initial, async (root) => {
    const workspace = lightWorkspace(root, "atomic");
    const alias = await symbolAlias(workspace, "a");
    const overlap = await workspace.edits.edit(
      {
        operations: [
          {
            kind: "symbol",
            target: alias,
            action: "replace",
            content: "export function a() { return 3 }",
          },
          { kind: "symbol", target: alias, action: "delete" },
        ],
      },
      { sessionId: "atomic", toolCallId: "overlap" },
    );
    assert.equal(overlap.status, "blocked");
    const invalid = await workspace.edits.edit(
      {
        operations: [
          {
            kind: "patch",
            patch: multiFilePatch([
              [
                "*** Update File: a.ts",
                "@@",
                "-export function a() { return 1 }",
                "+export function a() { return 4 }",
              ],
              [
                "*** Update File: b.ts",
                "@@",
                "-export function b() { return 2 }",
                "+export function b(",
              ],
            ]),
          },
        ],
      },
      { sessionId: "atomic", toolCallId: "invalid" },
    );
    assert.equal(invalid.status, "blocked");
    assert.equal(await readFile(join(root, "a.ts"), "utf8"), initial["a.ts"]);
    assert.equal(await readFile(join(root, "b.ts"), "utf8"), initial["b.ts"]);
  });
});

test("a failure on the last file rolls back the complete batch", async () => {
  const initial = { "a.txt": "a\n", "b.txt": "b\n" };
  await withWorkspace(initial, async (root) => {
    const files = new FailingWriteWorkspaceFiles(root);
    const snapshot = await files.snapshot();
    const commit = new LightCommitService(files);
    await assert.rejects(
      commit.commit(
        [
          mutation("a.txt", "a\n", "changed-a\n"),
          mutation("b.txt", "b\n", "changed-b\n"),
        ],
        snapshot.revision.source_revision_id,
      ),
      /simulated final write failure/u,
    );
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), initial["a.txt"]);
    assert.equal(await readFile(join(root, "b.txt"), "utf8"), initial["b.txt"]);
  });
});

test("patch operations create and delete files atomically", async () => {
  await withWorkspace({ "old.txt": "old\n" }, async (root) => {
    const workspace = lightWorkspace(root, "files");
    const result = await workspace.edits.edit(
      {
        operations: [
          {
            kind: "patch",
            patch: multiFilePatch([
              ["*** Add File: new.txt", "+new"],
              ["*** Delete File: old.txt"],
            ]),
          },
        ],
      },
      { sessionId: "files", toolCallId: "move" },
    );
    assert.equal(result.status, "ok");
    assert.equal(await readFile(join(root, "new.txt"), "utf8"), "new");
    await assert.rejects(readFile(join(root, "old.txt"), "utf8"));
  });
});

test("stale aliases relocate once only when identity remains unique", async () => {
  const source = "export function target() { return 1 }\n";
  await withWorkspace({ "target.ts": source }, async (root) => {
    const workspace = lightWorkspace(root, "rebase");
    const alias = await symbolAlias(workspace, "target");
    await writeFile(join(root, "target.ts"), `const prefix = 0\n${source}`);
    const result = await workspace.edits.edit(
      {
        operations: [
          {
            kind: "symbol",
            target: alias,
            action: "replace_body",
            content: "{ return 2 }",
          },
        ],
      },
      { sessionId: "rebase", toolCallId: "relocate" },
    );
    assert.equal(result.status, "ok");
    assert.match(await readFile(join(root, "target.ts"), "utf8"), /return 2/u);
  });
});

function lightWorkspace(root: string, sessionId: string) {
  const taskContract = contract(sessionId);
  return new LightWorkspace(root, {
    sessionId,
    taskContract,
  });
}

function contract(sessionId: string) {
  return {
    acceptance_criteria: ["apply requested change"],
    effect_requirement: "source_change" as const,
    objective: "apply requested change",
    session_id: sessionId,
  };
}

class FailingWriteWorkspaceFiles extends WorkspaceFiles {
  private resolutions = 0;

  override async resolveForWriteVerified(path: string) {
    this.resolutions += 1;
    if (this.resolutions === 4)
      throw new Error("simulated final write failure");
    return super.resolveForWriteVerified(path);
  }
}

function mutation(path: string, before: string, after: string) {
  return {
    after: Buffer.from(after),
    before: Buffer.from(before),
    mode: 0o644,
    path,
  };
}

async function symbolAlias(workspace: LightWorkspace, query: string) {
  const result = data(await workspace.searchCode({ query, mode: "symbol" }));
  return String(record(array(result.results)[0]).alias);
}

function applyPatch(path: string, lines: string[]) {
  return [
    "*** Begin Patch",
    `*** Update File: ${path}`,
    "@@",
    ...lines,
    "*** End Patch",
  ].join("\n");
}

function multiFilePatch(operations: string[][]) {
  return ["*** Begin Patch", ...operations.flat(), "*** End Patch"].join("\n");
}

async function withWorkspace(
  files: Record<string, string>,
  run: (root: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-light-test-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(join(root, path, ".."), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function data(result: LightToolResult<unknown>) {
  assert.equal(
    result.status,
    "ok",
    result.status === "ok" ? undefined : result.message,
  );
  return record(result.status === "ok" ? result.data : undefined);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
