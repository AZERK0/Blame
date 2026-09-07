import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { blockedCommandReason } from "./command-policy.js";
import { LightCommitService } from "./light-commit.js";
import type { LightCompletionNotification } from "./light-completion.js";
import { LightFinishService } from "./light-finish-service.js";
import { lightSemanticHarnessTools } from "./light-tools.js";
import { LightWorkspace } from "./light-workspace.js";
import { completionAwareTerminalState } from "./run-lifecycle.js";
import { SessionJournal } from "./session-journal.js";
import { WorkspaceFiles } from "./workspace-files.js";

test("a changed symbol requires a fresh observation before replacement", async () => {
  await fixture(
    { "a.ts": "export function value() { return 1; }\n" },
    async (root, workspace) => {
      const read = await workspace.readCode({ target: "a.ts#value" }, {});
      assert.equal(read.status, "ok");
      const alias = String((read as { data: { alias: string } }).data.alias);
      await writeFile(
        join(root, "a.ts"),
        "export function value() { return 99; }\n",
      );
      const input = {
        operations: [
          {
            kind: "symbol" as const,
            target: alias,
            action: "replace_body" as const,
            content: "{ return 2; }",
          },
        ],
      };
      assert.equal((await workspace.editCode(input)).status, "blocked");
      assert.match(await readFile(join(root, "a.ts"), "utf8"), /return 99/u);
      await workspace.readCode({ target: alias }, {});
      assert.equal((await workspace.editCode(input)).status, "ok");
      assert.match(await readFile(join(root, "a.ts"), "utf8"), /return 2/u);
    },
  );
});

test("a symbol alias rebases when only a neighbouring declaration changes", async () => {
  const source =
    "export function value() { return 1; }\nexport const sibling = 0;\n";
  await fixture({ "a.ts": source }, async (root, workspace) => {
    const read = await workspace.readCode({ target: "a.ts#value" }, {});
    const alias = String((read as { data: { alias: string } }).data.alias);
    await writeFile(
      join(root, "a.ts"),
      source.replace("sibling = 0", "sibling = 99"),
    );
    const result = await workspace.editCode({
      operations: [
        {
          kind: "symbol",
          target: alias,
          action: "replace_body",
          content: "{ return 2; }",
        },
      ],
    });
    assert.equal(result.status, "ok", JSON.stringify(result));
    assert.match(await readFile(join(root, "a.ts"), "utf8"), /sibling = 99/u);
  });
});

test("an aborted public edit cannot write source", async () => {
  await fixture({ "a.ts": "export const value = 1;\n" }, async (root) => {
    const tool = lightSemanticHarnessTools(root, {
      taskContract: { session_id: "abort" },
    }).find(({ name }) => name === "edit_code")!;
    const controller = new AbortController();
    const pending = tool.execute(
      {
        operations: [
          {
            kind: "symbol",
            target: "a.ts#value",
            action: "replace",
            content: "export const value = 2;",
          },
        ],
      },
      { signal: controller.signal } as never,
    );
    controller.abort();
    const result = await pending;
    assert.equal((result as { status: string }).status, "blocked");
    assert.equal(
      await readFile(join(root, "a.ts"), "utf8"),
      "export const value = 1;\n",
    );
  });
});

test("cancellation during commit preparation leaves the batch unchanged", async () => {
  await fixture({ "a.txt": "before" }, async (root) => {
    const files = new WorkspaceFiles(root);
    const controller = new AbortController();
    const resolve = files.resolveForWriteVerified.bind(files);
    files.resolveForWriteVerified = async (path) => {
      controller.abort();
      return resolve(path);
    };
    const revision = (await files.snapshot()).revision.source_revision_id;
    await assert.rejects(
      new LightCommitService(files).commit(
        [
          {
            path: "a.txt",
            before: Buffer.from("before"),
            after: Buffer.from("after"),
          },
        ],
        revision,
        controller.signal,
      ),
      /abort/iu,
    );
    assert.equal(await readFile(join(root, "a.txt"), "utf8"), "before");
  });
});

test("a check cannot prove source changed during execution", async () => {
  await fixture(
    {
      "a.ts": "export const value = 1;\n",
      "package.json": manifest({ build: "node check.cjs" }),
      "check.cjs":
        "const fs = require('fs'); fs.writeFileSync('.blame/observed', 'yes'); setTimeout(() => process.exit(0), 500);",
    },
    async (root, workspace) => {
      await editValue(workspace, 1, 2);
      const pending = workspace.runTask({ kind: "project", task: "build" }, {});
      await waitFor(join(root, ".blame/observed"));
      await editValue(workspace, 2, 3);
      const result = await pending;
      assert.equal(result.status, "ok");
      assert.equal(
        (result as { data: { validation: { status: string } } }).data.validation
          .status,
        "stale",
      );
      assert.equal(
        (await new SessionJournal(root, "invariants").completionSnapshot())
          .validations.length,
        0,
      );
    },
  );
});

test("the same command executes independently in different directories", async () => {
  await fixture({ "a/file": "", "b/flag": "" }, async (_root, workspace) => {
    const command = "test -f flag";
    assert.equal(
      (await workspace.runTask({ kind: "command", command, cwd: "a" }, {}))
        .status,
      "blocked",
    );
    assert.equal(
      (await workspace.runTask({ kind: "command", command, cwd: "b" }, {}))
        .status,
      "ok",
    );
  });
});

test("a passing build cannot hide a failing test and a real retry can recover", async () => {
  await fixture(
    {
      "a.ts": "export const value = 1;\n",
      "package.json": manifest({
        build: "node --version",
        test: "node check.cjs",
      }),
      "check.cjs":
        "process.exit(require('fs').existsSync('.blame/repaired') ? 0 : 1);",
    },
    async (root, workspace) => {
      await editValue(workspace, 1, 2);
      await workspace.runTask({ kind: "command", command: "npm test" }, {});
      await workspace.runTask({ kind: "project", task: "build" }, {});
      const notifications: LightCompletionNotification[] = [];
      const finish = finisher(root, notifications);
      await assert.rejects(
        finish.finish("Completed", {} as never),
        /still failing/u,
      );
      assert.equal(notifications.length, 0);
      await writeFile(join(root, ".blame/repaired"), "yes");
      assert.equal(
        (await workspace.runTask({ kind: "project", task: "test" }, {})).status,
        "ok",
      );
      await finish.finish("Completed", {} as never);
      assert.equal(notifications[0]?.verified, true);
    },
  );
});

test("round trips have no delivered source effect and explanation tasks can finish", async () => {
  await fixture(
    { "a.ts": "export const value = 1;\n" },
    async (root, workspace) => {
      await editValue(workspace, 1, 2);
      await editValue(workspace, 2, 1);
      assert.deepEqual(
        (await new SessionJournal(root, "invariants").completionSnapshot())
          .changedPaths,
        [],
      );
      const notifications: LightCompletionNotification[] = [];
      await finisher(root, notifications).finish(
        "Explained the existing behavior",
        {} as never,
      );
      assert.equal(notifications[0]?.completion.verification, "not_applicable");
      assert.equal(
        completionAwareTerminalState("succeeded", notifications[0]?.completion),
        "succeeded",
      );
      const strict = new LightFinishService({
        workspaceRoot: root,
        conversationId: "invariants",
        taskContract: { effect_requirement: "source_change" },
      });
      await assert.rejects(
        strict.finish("No change", {} as never),
        /source change/u,
      );
    },
  );
});

test("a package check covers its own changes and finish checks both changed packages", async () => {
  await fixture(
    {
      "package.json": manifest({ build: "node --version" }),
      "a.ts": "export const value = 1;\n",
      "nested/package.json": manifest({ test: "node --version" }),
      "nested/b.ts": "export const value = 1;\n",
    },
    async (root, workspace) => {
      await editValue(workspace, 1, 2);
      await editValue(workspace, 1, 2, "nested/b.ts");
      const result = await workspace.runTask(
        { kind: "project", task: "build" },
        {},
      );
      assert.deepEqual(
        (result as { data: { validation: { paths: string[] } } }).data
          .validation.paths,
        ["a.ts"],
      );
      const notifications: LightCompletionNotification[] = [];
      await finisher(root, notifications).finish("Both updated", {} as never);
      assert.equal(notifications[0]?.verified, true);
      const journal = await new SessionJournal(
        root,
        "invariants",
      ).completionSnapshot();
      assert.equal(
        journal.validations.filter(({ terminal }) => terminal === "passed")
          .length,
        2,
      );
    },
  );
});

test("shell syntax distinguishes inspection from adjacent output redirection", () => {
  assert.equal(blockedCommandReason('node -e "console.log(8 > 3)"'), undefined);
  assert.equal(blockedCommandReason("git -C . status"), undefined);
  assert.equal(
    blockedCommandReason("cat node_modules/example/package.json"),
    undefined,
  );
  assert.equal(blockedCommandReason("printf audit>marker.txt"), undefined);
  assert.match(
    blockedCommandReason("git -C . add source.ts") ?? "",
    /Git mutations/u,
  );
});

test("editing another value does not erase the need to rerun a failing test", async () => {
  await fixture(
    {
      "a.ts": "export const value = 1;\n",
      "package.json": manifest({
        build: "node --version",
        test: 'node -e "process.exit(1)"',
      }),
    },
    async (root, workspace) => {
      await editValue(workspace, 1, 2);
      await workspace.runTask({ kind: "project", task: "test" }, {});
      await editValue(workspace, 2, 3);
      const notifications: LightCompletionNotification[] = [];
      await assert.rejects(
        finisher(root, notifications).finish("Complete", {} as never),
        /Command exited/u,
      );
      assert.equal(notifications.length, 0);
    },
  );
});

function manifest(scripts: Record<string, string>) {
  return JSON.stringify({ scripts });
}

function finisher(root: string, notifications: LightCompletionNotification[]) {
  return new LightFinishService({
    workspaceRoot: root,
    conversationId: "invariants",
    onComplete: (value) => {
      notifications.push(value);
    },
  });
}

function editValue(
  workspace: LightWorkspace,
  before: number,
  after: number,
  path = "a.ts",
) {
  return workspace.editCode({
    operations: [
      {
        kind: "patch",
        path,
        patch: `*** Begin Patch\n*** Update File: ${path}\n@@\n-export const value = ${before};\n+export const value = ${after};\n*** End Patch`,
      },
    ],
  });
}

async function fixture(
  files: Record<string, string>,
  run: (root: string, workspace: LightWorkspace) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-invariants-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), content);
    }
    await run(root, new LightWorkspace(root, { sessionId: "invariants" }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function waitFor(path: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await access(path).then(
        () => true,
        () => false,
      )
    )
      return;
    await delay(20);
  }
  throw new Error(`Timed out waiting for ${path}`);
}

test("snapshot cancellation interrupts a large file without returning an incomplete revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-hash-cancel-"));
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const file = await open(join(root, "artifact.bin"), "w");
    try { await file.truncate(512 * 1024 * 1024); } finally { await file.close(); }
    timer = setTimeout(() => controller.abort(), 30);
    await assert.rejects(new WorkspaceFiles(root).snapshot(controller.signal), { name: "AbortError" });
  } finally {
    clearTimeout(timer);
    await rm(root, { force: true, recursive: true });
  }
});
