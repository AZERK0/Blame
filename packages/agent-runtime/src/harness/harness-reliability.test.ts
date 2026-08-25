import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { validateContent } from "./content-validation.js";
import { jsoncErrors } from "./json-editor.js";
import {
  capabilityRegistrySnapshot,
  supportedOperationsDescription,
} from "./language-capabilities.js";
import { type HarnessToolResult, type HarnessToolSuccess } from "./protocol.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import { readTaskCatalog, taskInvocation } from "./task-catalog.js";
import type { TaskExecutor } from "./task-executor.js";

test("the capability prompt is generated from the central registry", () => {
  const description = supportedOperationsDescription();
  const extensions = capabilityRegistrySnapshot().flatMap(
    (capability) => capability.extensions,
  );
  for (const extension of extensions)
    assert.match(description, new RegExp(escape(extension)));
  assert.equal(new Set(extensions).size, extensions.length);
});

test("JSONC editing preserves comments and never creates duplicate commas", async () => {
  await withWorkspace(async (root, workspace) => {
    const path = join(root, "config.jsonc");
    await writeFile(
      path,
      '{\n  // retained\n  "items": [1],\n  "old": true\n}\n',
    );
    const result = success(
      await workspace.editJson({
        path: "config.jsonc",
        operations: [
          { type: "append", path: ["items"], value: 2 },
          { type: "delete", path: ["old"] },
          { type: "set", path: ["enabled"], value: true },
        ],
      }),
    );
    const content = await readFile(path, "utf8");
    assert.equal(result.data.outcome, "applied");
    assert.equal(result.data.validation.status, "passed");
    assert.match(content, /\/\/ retained/u);
    assert.equal(jsoncErrors(content).length, 0);
    assert.doesNotMatch(content, /,,/u);
  });
});

test("unsupported validation is never reported as passed", async () => {
  await withWorkspace(async (root) => {
    const validation = await validateContent({
      content: Buffer.from("opaque text\n"),
      path: "notes.unknown",
      workspaceRoot: root,
    });
    assert.equal(validation.status, "not_supported");
    assert.equal(validation.validator, null);
  });
});

test("semantic editing is refused immediately for Prisma", async () => {
  await withWorkspace(async (root, workspace) => {
    await writeFile(join(root, "schema.prisma"), "model User { id Int @id }\n");
    const result = success(
      await workspace.editSymbol({
        path: "schema.prisma",
        symbolRef: "sym://unsupported",
        replacement: "model User { id String @id }",
      }),
    );
    assert.equal(result.data.outcome, "unsupported_operation");
    if (result.data.status !== "unsupported_operation")
      assert.fail("Expected unsupported operation");
    assert.equal(result.data.recommendedTool, "patch_file");
  });
});

test(
  "invalid Prisma is rejected by the project-local validator",
  { skip: process.platform === "win32" },
  async () => {
    await withWorkspace(async (root) => {
      const directory = join(root, "node_modules", ".bin");
      const executable = join(directory, "prisma");
      await mkdir(directory, { recursive: true });
      await writeFile(
        executable,
        "#!/bin/sh\necho invalid schema >&2\nexit 1\n",
      );
      await chmod(executable, 0o755);
      const validation = await validateContent({
        content: Buffer.from("model User {\n"),
        path: "schema.prisma",
        workspaceRoot: root,
      });
      assert.equal(validation.status, "failed");
      assert.equal(validation.validator, "prisma");
    });
  },
);

test("patch_file rejects patches targeting multiple files", async () => {
  await withWorkspace(async (_root, workspace) => {
    const result = success(
      await workspace.patchFile({
        path: "first.txt",
        patch: multiFilePatch,
      }),
    );
    assert.equal(result.data.outcome, "unsupported_operation");
    if (result.data.status !== "unsupported_operation")
      assert.fail("Expected unsupported operation");
    assert.equal(result.data.reasonCode, "MULTI_FILE_PATCH");
    assert.equal(result.data.recommendedTool, "edit_files");
  });
});

test("edit_files rolls back every file when one validation fails", async () => {
  await withWorkspace(async (root, workspace) => {
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "create_file",
            path: "valid.ts",
            content: "export const value = 1;\n",
          },
          { operation: "create_file", path: "invalid.json", content: "{,}\n" },
        ],
      }),
    );
    assert.equal(result.data.outcome, "validation_failed");
    assert.equal(await exists(join(root, "valid.ts")), false);
    assert.equal(await exists(join(root, "invalid.json")), false);
  });
});

test("delete_file removes the complete file", async () => {
  await withWorkspace(async (root, workspace) => {
    const path = join(root, "obsolete.txt");
    await writeFile(path, "remove me\n");
    const result = success(
      await workspace.deleteFile({ path: "obsolete.txt" }),
    );
    assert.equal(result.data.outcome, "applied");
    assert.equal(await exists(path), false);
  });
});

test("build task definitions never forward selected files", async () => {
  await withWorkspace(async (root) => {
    const catalog = await readTaskCatalog(root);
    const build = catalog.find((task) => task.task_id === "build");
    assert.ok(build);
    assert.equal(build.supportsFileSelection, false);
    assert.deepEqual(taskInvocation(build, { files: ["src/app.ts"] }).args, [
      "run",
      "build",
    ]);
  });
});

test("an edit invalidates only read receipts for the changed file", async () => {
  await withWorkspace(async (_root, workspace) => {
    const initial = success(await workspace.workspaceState()).data
      .source_revision;
    const epoch = { contextEpoch: "stable-epoch" };
    await workspace.inspectCode(
      { target: { path: "first.txt" }, view: "raw" },
      undefined,
      epoch,
    );
    await workspace.inspectCode(
      { target: { path: "second.txt" }, view: "raw" },
      undefined,
      epoch,
    );
    await workspace.replaceFile({ path: "first.txt", content: "changed\n" });
    const current = success(await workspace.workspaceState()).data
      .source_revision;
    assert.notEqual(current.source_revision_id, initial.source_revision_id);
    const unchanged = success(
      await workspace.inspectCode(
        { target: { path: "second.txt" }, view: "raw" },
        undefined,
        epoch,
      ),
    );
    const changed = success(
      await workspace.inspectCode(
        { target: { path: "first.txt" }, view: "raw" },
        undefined,
        epoch,
      ),
    );
    assert.equal(unchanged.data.status, "already_available");
    assert.equal(unchanged.data.sourceUnchanged, true);
    assert.equal(changed.data.status, "content");
  });
});

test("Corepack failures are classified as infrastructure errors", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root, {
      taskExecutor: corepackFailureExecutor,
    });
    const revision = success(await workspace.workspaceState()).data
      .source_revision;
    const run = success(
      await workspace.runTask({
        source_revision_id: revision.source_revision_id,
        task: { task_id: "build" },
        limits: { timeout_ms: 10_000 },
      }),
    );
    assert.equal(run.data.status, "execution_error");
    assert.equal(run.data.outcome, "infrastructure_error");
  });
});

async function withWorkspace(
  operation: (root: string, workspace: SemanticWorkspace) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "blame-reliability-"));
  try {
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { build: "tsc", test: "node --test" } }),
    );
    await writeFile(join(root, "first.txt"), "first\n");
    await writeFile(join(root, "second.txt"), "second\n");
    await operation(root, new SemanticWorkspace(root));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function success<T>(result: HarnessToolResult<T>): HarnessToolSuccess<T> {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function escape(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const multiFilePatch = [
  "--- a/first.txt",
  "+++ b/first.txt",
  "@@ -1 +1 @@",
  "-first",
  "+changed first",
  "--- a/second.txt",
  "+++ b/second.txt",
  "@@ -1 +1 @@",
  "-second",
  "+changed second",
  "",
].join("\n");

const corepackFailureExecutor: TaskExecutor = {
  async capability() {
    return "worktree";
  },
  async execute() {
    return {
      status: "failed",
      exitCode: 1,
      signal: null,
      stdout: "",
      stderr: "Corepack failed to download pnpm",
      outputTruncated: false,
      isolation: "worktree",
    };
  },
};
