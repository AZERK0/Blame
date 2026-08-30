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
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { request as httpRequest } from "node:http";
import test from "node:test";
import { execa } from "execa";
import { validateContent } from "./content-validation.js";
import {
  contextPressureHooks,
  effectiveCompactionModels,
} from "./context-pressure.js";
import { ExternalReadGovernor } from "./external-read-governor.js";
import { createEditGroups } from "./edit-batch.js";
import { jsoncErrors } from "./json-editor.js";
import {
  capabilityRegistrySnapshot,
  supportedOperationsDescription,
} from "./language-capabilities.js";
import {
  boundHarnessResult,
  encodeHandle,
  harnessSuccess,
  type HarnessToolResult,
  type HarnessToolSuccess,
} from "./protocol.js";
import {
  nodeExecutableCandidates,
  packageManagerVersionsCompatible,
  physicalBundledPath,
  resolvePackageManager,
  resolveStableNodeExecutable,
  type PackageManagerName,
} from "./package-manager-runtime.js";
import { editFilesInputSchema } from "./schemas.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import {
  SemanticLoopDetector,
  semanticCallSignature,
} from "./semantic-loop-detector.js";
import { readTaskCatalog, taskInvocation } from "./task-catalog.js";
import {
  automaticDependencyNetworkPolicy,
  SandboxedTaskExecutor,
  type TaskExecutionInput,
  type TaskExecutor,
} from "./task-executor.js";
import {
  configuredRegistryHosts,
  startRegistryAllowlistProxy,
} from "./registry-allowlist-proxy.js";

test("the capability prompt is generated from the central registry", () => {
  const description = supportedOperationsDescription();
  const extensions = capabilityRegistrySnapshot().flatMap(
    (capability) => capability.extensions,
  );
  for (const extension of extensions)
    assert.match(description, new RegExp(escape(extension)));
  assert.equal(new Set(extensions).size, extensions.length);
});

test("the effective model window triggers Cline compaction at 67.5 percent", () => {
  const models = effectiveCompactionModels(
    { model: { contextWindow: 200_000 } as never },
    "model",
    0.675,
    200_000,
  );
  assert.equal(models.model?.contextWindow, 150_000);
  assert.equal(Math.floor(models.model!.contextWindow! * 0.9), 135_000);
});

test("the effective model window also respects the absolute context threshold", () => {
  const models = effectiveCompactionModels(
    { model: { contextWindow: 1_000_000 } as never },
    "model",
    0.8,
    96_000,
  );
  assert.ok(models.model?.contextWindow);
  assert.ok(models.model!.contextWindow! * 0.9 <= 96_000);
});

test("context pressure leaves transcript compaction to Cline", async () => {
  const hooks = contextPressureHooks({
    warningRatio: 0.5,
  });
  const result = await hooks.beforeModel?.({
    request: {
      messages: [
        { role: "user", content: [{ type: "text", text: "request" }] },
        { role: "assistant", content: [{ type: "text", text: "response" }] },
      ],
    },
    snapshot: { iteration: 70 },
  } as never);
  assert.equal(result, undefined);
});

test("context pressure leaves completion policy and tool availability to Cline", async () => {
  const hooks = contextPressureHooks({
    warningRatio: 0.5,
  });
  const result = await hooks.beforeModel?.({
    request: {
      messages: [{ role: "user", content: [{ type: "text", text: "finish" }] }],
      tools: [{ name: "search_code" }, { name: "submit_and_exit" }],
    },
    snapshot: { iteration: 120 },
  } as never);
  assert.equal(result, undefined);
});

test("semantic loop detection replays A-B-A-B without repeated I/O", () => {
  const detector = new SemanticLoopDetector();
  const search = { query: "target", source_revision_id: "first" };
  const inspect = {
    target: { match_ref: "match://first" },
    view: "body",
  };
  const searchResult = successfulResult({ matches: ["target"] });
  const inspectResult = successfulResult({ content: "target" });
  assert.equal(detector.before("search_code", search), undefined);
  detector.after("search_code", search, searchResult);
  assert.equal(detector.before("inspect_code", inspect), undefined);
  detector.after("inspect_code", inspect, inspectResult);
  assert.equal(detector.before("search_code", search)?.status, "success");
  assert.equal(detector.before("inspect_code", inspect)?.status, "success");
  detector.before("search_code", search);
  const notice = detector.before("inspect_code", inspect);
  assert.equal(notice?.status, "success");
  if (notice?.status === "success")
    assert.equal(
      (notice.data as { status?: string }).status,
      "already_available",
    );
});

test("semantic call normalization preserves targets and ignores handle revision", () => {
  const firstReference = testMatchReference(
    "src_11111111111111111111111111111111",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const revisedReference = testMatchReference(
    "src_22222222222222222222222222222222",
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const otherReference = testMatchReference(
    "src_22222222222222222222222222222222",
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  );
  const first = semanticCallSignature("inspect_code", {
    source_revision_id: "one",
    view: "body",
    target: { match_ref: firstReference },
  });
  const second = semanticCallSignature("inspect_code", {
    target: { match_ref: revisedReference },
    view: "body",
    source_revision_id: "two",
  });
  const other = semanticCallSignature("inspect_code", {
    target: { match_ref: otherReference },
    view: "body",
  });
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test("semantic cache never returns a result for another match target", () => {
  const detector = new SemanticLoopDetector();
  const revision = "src_11111111111111111111111111111111";
  const first = {
    target: {
      match_ref: testMatchReference(
        revision,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      ),
    },
    view: "body",
  };
  const second = {
    target: {
      match_ref: testMatchReference(
        revision,
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      ),
    },
    view: "body",
  };
  detector.after("inspect_code", first, successfulResult({ content: "AAA" }));
  assert.equal(detector.before("inspect_code", second), undefined);
});

test("five thousand cyclic reads execute only the first two I/O operations", () => {
  const detector = new SemanticLoopDetector();
  let executions = 0;
  const startedAt = performance.now();
  for (let index = 0; index < 5_000; index += 1) {
    const tool = index % 2 ? "inspect_code" : "search_code";
    const input =
      index % 2
        ? { target: { match_ref: "match://target" }, view: "body" }
        : { query: "target" };
    const decision = detector.before(tool, input);
    if (decision) continue;
    executions += 1;
    detector.after(tool, input, successfulResult({ index }));
  }
  const durationMs = performance.now() - startedAt;
  assert.equal(executions, 2);
  assert.ok(Number.isFinite(durationMs));
});

function testMatchReference(revision: string, digest: string) {
  return encodeHandle("match", {
    version: 2,
    revision,
    path: "src/example.ts",
    start: 0,
    end: 6,
    digest,
    kind: "text_match",
    language: "typescript",
    matchedText: "target",
  });
}

test("the requested token budget bounds the complete success envelope", () => {
  const result = harnessSuccess({
    data: { rows: Array.from({ length: 100 }, () => "x".repeat(500)) },
    revision: { source_revision_id: "src_00000000000000000000000000000000" },
    startedAt: Date.now(),
    provenance: [],
  });
  const bounded = boundHarnessResult(result, 200);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), "utf8") <= 800);
  assert.equal(bounded.status, "success");
  if (bounded.status === "success")
    assert.equal(bounded.coverage.truncated, true);
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

test("an unavailable Prisma validator leaves the applied edit pending", async () => {
  await withWorkspace(async (root, workspace) => {
    const validation = await validateContent({
      content: Buffer.from("model User { id Int @id }\n"),
      path: "schema.prisma",
      workspaceRoot: root,
    });
    assert.equal(validation.status, "validator_unavailable");
    const result = success(
      await workspace.createFile({
        path: "schema.prisma",
        content: "model User { id Int @id }\n",
      }),
    );
    assert.equal(result.data.status, "applied");
    if (result.data.status !== "applied") return;
    assert.equal(result.data.validation.status, "validator_unavailable");
    assert.equal(result.data.validation.parse, "pending");
    assert.equal(await exists(join(root, "schema.prisma")), true);
  });
});

test("TypeScript validation rejects invalid imports in TS, TSX, JS, and JSX", async () => {
  await withWorkspace(async (root) => {
    for (const extension of ["ts", "tsx", "js", "jsx"]) {
      const validation = await validateContent({
        content: Buffer.from(invalidImport),
        path: `src/projects-carousel.${extension}`,
        workspaceRoot: root,
      });
      assert.equal(validation.status, "failed", extension);
      assert.equal(validation.validator, "typescript", extension);
      assert.match(
        validation.diagnostics.join("\n"),
        /Unexpected keyword/u,
        extension,
      );
    }
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

test("patch_file applies the native Apply Patch envelope", async () => {
  await withWorkspace(async (root, workspace) => {
    await writeFile(
      join(root, "styles.css"),
      '@import "tailwindcss";\n\nbody { color: black; }\n',
    );
    const result = success(
      await workspace.patchFile({
        path: "styles.css",
        patch: [
          "*** Begin Patch",
          "*** Update File: styles.css",
          "@@",
          " body { color: black; }",
          "+.projects { display: block; }",
          "*** End of File",
          "*** End Patch",
        ].join("\n"),
      }),
    );
    assert.equal(result.data.outcome, "applied");
    assert.match(
      await readFile(join(root, "styles.css"), "utf8"),
      /\.projects/u,
    );
  });
});

test("patch_file reports ambiguous Apply Patch anchors without writing", async () => {
  await withWorkspace(async (root, workspace) => {
    await writeFile(join(root, "styles.css"), ".first {\n}\n.second {\n}\n");
    const result = success(
      await workspace.patchFile({
        path: "styles.css",
        patch: [
          "*** Begin Patch",
          "*** Update File: styles.css",
          "@@",
          " }",
          "+.projects { display: block; }",
          "*** End Patch",
        ].join("\n"),
      }),
    );
    assert.equal(result.data.outcome, "conflict");
    if (result.data.status !== "conflict") assert.fail("Expected conflict");
    assert.match(result.data.reason, /more than one|ambiguous/iu);
    assert.ok(result.data.candidates.length > 1);
    assert.equal(
      await readFile(join(root, "styles.css"), "utf8"),
      ".first {\n}\n.second {\n}\n",
    );
  });
});

test("edit_files inserts text at a file boundary without an anchor", async () => {
  await withWorkspace(async (root, workspace) => {
    await writeFile(join(root, "styles.css"), "body { color: black; }\n");
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "insert_text",
            path: "styles.css",
            position: "end",
            content: "\n.projects { display: block; }\n",
          },
        ],
      }),
    );
    assert.equal(result.data.outcome, "applied");
    assert.equal(
      await readFile(join(root, "styles.css"), "utf8"),
      "body { color: black; }\n\n.projects { display: block; }\n",
    );
  });
});

test("edit_files partitions unrelated files by inferred path coupling", async () => {
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
    assert.equal(result.data.outcome, "applied");
    if (result.data.status !== "applied") return;
    assert.equal(result.data.partial, true);
    assert.deepEqual(
      result.data.failed_operations?.map(({ path }) => path),
      ["invalid.json"],
    );
    assert.equal(await exists(join(root, "valid.ts")), true);
    assert.equal(await exists(join(root, "invalid.json")), false);
  });
});

test("edit_files rejects the removed atomicity compatibility hint", () => {
  assert.throws(() =>
    editFilesInputSchema.parse({
      atomicity: "strict",
      operations: [
        { operation: "create_file", path: "created.ts", content: "" },
      ],
    }),
  );
});

test("edit partitioning keeps operations on the same path coupled", () => {
  const groups = createEditGroups([
    {
      operation: "replace_file",
      path: "coupled.ts",
      content: "export const value = 1;\n",
    },
    {
      operation: "replace_file",
      path: "coupled.ts",
      content: invalidImport,
    },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0]?.indexes, [0, 1]);
});

test("edit_files applies independent files and reports the failing operation", async () => {
  await withWorkspace(async (root, workspace) => {
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "create_file",
            path: "valid-independent.ts",
            content: "export const value = 1;\n",
          },
          {
            operation: "create_file",
            path: "invalid-independent.tsx",
            content: invalidImport,
          },
        ],
      }),
    );
    assert.equal(result.data.outcome, "applied");
    if (result.data.status !== "applied") assert.fail("Expected partial apply");
    assert.equal(result.data.partial, true);
    assert.equal(result.data.validation.status, "failed");
    assert.deepEqual(
      result.data.failed_operations?.map((failure) => failure.operation_index),
      [1],
    );
    assert.match(
      result.data.failed_operations?.[0]?.diagnostics?.join("\n") ?? "",
      /Unexpected keyword/u,
    );
    assert.deepEqual(
      result.data.validation.files.map(({ path, status }) => ({
        path,
        status,
      })),
      [
        { path: "valid-independent.ts", status: "passed" },
        { path: "invalid-independent.tsx", status: "failed" },
      ],
    );
    assert.equal(await exists(join(root, "valid-independent.ts")), true);
    assert.equal(await exists(join(root, "invalid-independent.tsx")), false);
  });
});

test("edit_files reports independent operations that produced no change", async () => {
  await withWorkspace(async (root, workspace) => {
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "create_file",
            path: "created.ts",
            content: "export const created = true;\n",
          },
          { operation: "replace_file", path: "first.txt", content: "first\n" },
        ],
      }),
    );
    assert.equal(result.reason, "PARTIAL_BATCH_APPLIED");
    if (result.data.status !== "applied") assert.fail("Expected partial apply");
    assert.equal(result.data.partial, true);
    assert.deepEqual(result.data.skipped_operations, [
      {
        operation_index: 1,
        path: "first.txt",
        reason: "NO_CHANGE",
        status: "no_change",
      },
    ]);
    const groups = result.data.groups;
    assert.ok(groups);
    assert.equal(groups[0]?.outcome, "applied");
    assert.equal(groups[1]?.outcome, "already_satisfied");
    assert.equal(
      groups[1]?.source_revision_before,
      groups[0]?.source_revision_after,
    );
    assert.equal(
      groups[1]?.source_revision_after,
      groups[0]?.source_revision_after,
    );
    assert.equal(await exists(join(root, "created.ts")), true);
  });
});

test("edit_files returns every independent validation failure", async () => {
  await withWorkspace(async (root, workspace) => {
    const result = success(
      await workspace.editFiles({
        operations: [
          {
            operation: "create_file",
            path: "invalid-first.js",
            content: invalidImport,
          },
          {
            operation: "create_file",
            path: "invalid-second.json",
            content: "{,}\n",
          },
        ],
      }),
    );
    assert.equal(result.data.outcome, "validation_failed");
    if (result.data.status !== "validation_failed")
      assert.fail("Expected validation failure");
    assert.deepEqual(result.data.failed_operation_indexes, [0, 1]);
    assert.deepEqual(
      result.data.failed_operations?.map(
        ({ operation_index }) => operation_index,
      ),
      [0, 1],
    );
    assert.match(
      result.data.failed_operations?.[0]?.diagnostics?.join("\n") ?? "",
      /Unexpected keyword/u,
    );
    assert.match(
      result.data.failed_operations?.[1]?.diagnostics?.join("\n") ?? "",
      /JSON error/u,
    );
    assert.equal(await exists(join(root, "invalid-first.js")), false);
    assert.equal(await exists(join(root, "invalid-second.json")), false);
  });
});

test("an already applied patch returns no_change", async () => {
  await withWorkspace(async (root, workspace) => {
    const first = success(
      await workspace.patchFile(
        { path: "first.txt", patch: singleFilePatch },
        { toolCallId: "patch-first" },
      ),
    );
    assert.equal(first.data.outcome, "applied");
    const repeated = success(
      await workspace.patchFile(
        { path: "first.txt", patch: singleFilePatch },
        { toolCallId: "patch-repeated" },
      ),
    );
    assert.equal(repeated.data.outcome, "no_change");
    assert.equal(
      await readFile(join(root, "first.txt"), "utf8"),
      "changed first\n",
    );
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

test("task definitions preserve the exact declared package manager version", async () => {
  await withWorkspace(async (root) => {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        packageManager: "pnpm@10.33.2+sha512.fixture",
        scripts: { build: "tsc" },
      }),
    );
    const catalog = await readTaskCatalog(root);
    const build = catalog.find((task) => task.task_id === "build");
    assert.equal(build?.package_manager, "pnpm");
    assert.equal(build?.package_manager_version, "10.33.2");
    assert.equal(taskInvocation(build!).packageManagerVersion, "10.33.2");
  });
});

test("dependency execution exposes a built-in configured-registry allowlist", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-registry-policy-"));
  try {
    await mkdir(join(root, "packages", "api"), { recursive: true });
    await writeFile(
      join(root, ".npmrc"),
      "registry=https://registry.corp.example/npm/\n@scope:registry=https://scope.example/npm/\n",
    );
    await writeFile(
      join(root, "packages", "api", ".yarnrc.yml"),
      'npmRegistryServer: "https://yarn.example/packages"\n',
    );
    const hosts = await configuredRegistryHosts(
      root,
      join(root, "packages", "api"),
    );
    assert.deepEqual([...hosts].sort(), [
      "registry.corp.example",
      "registry.npmjs.org",
      "scope.example",
      "yarn.example",
    ]);
    assert.equal(automaticDependencyNetworkPolicy(), "project_allowlist");
    assert.deepEqual(await new SandboxedTaskExecutor().dependencyCapability(), {
      available: true,
      network: "managed_allowlist",
    });
    const proxy = await startRegistryAllowlistProxy({
      cwd: join(root, "packages", "api"),
      overlayRoot: root,
    });
    try {
      const address = new URL(proxy.url);
      const status = await new Promise<number | undefined>((resolveStatus) => {
        const request = httpRequest(
          {
            host: address.hostname,
            method: "GET",
            path: "http://not-configured.invalid/package",
            port: Number(address.port),
          },
          (response) => {
            response.resume();
            resolveStatus(response.statusCode);
          },
        );
        request.end();
      });
      assert.equal(status, 403);
      assert.deepEqual(proxy.allowedHosts, [...hosts].sort());
    } finally {
      await proxy.close();
    }
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("all managed package managers resolve without Corepack", async () => {
  const versions: Array<[PackageManagerName, string]> = [
    ["npm", "11.6.4"],
    ["pnpm", "10.33.2"],
    ["yarn", "1.22.22"],
  ];
  for (const [name, version] of versions) {
    const manager = await resolvePackageManager({ name, version });
    assert.doesNotMatch(manager.executable, /corepack/iu);
    const result = await execa(
      manager.executable,
      [...manager.argsPrefix, "--version"],
      { reject: false },
    );
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout.trim(), version);
    assert.equal(manager.resolutionStrategy, "exact");
  }
});

test("bundled package managers avoid a temporary AppImage executable", async () => {
  const mountedExecutable = "/tmp/.mount_Blame123/@blamedesktop";
  const environment = {
    ...process.env,
    BLAME_NODE_EXECUTABLE: mountedExecutable,
  };
  const candidates = nodeExecutableCandidates(
    environment,
    mountedExecutable,
    "linux",
  );
  assert.ok(candidates.indexOf("/usr/bin/node") < candidates.length - 1);
  const executable = await resolveStableNodeExecutable(
    environment,
    mountedExecutable,
    "linux",
  );
  assert.ok(executable);
  assert.doesNotMatch(executable, /\/tmp\/\.mount_/u);
});

test("packaged manager paths resolve to the unpacked ASAR tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "blame-asar-path-"));
  try {
    const virtual = join(
      root,
      "app.asar",
      "node_modules",
      "pnpm",
      "package.json",
    );
    const unpacked = join(
      root,
      "app.asar.unpacked",
      "node_modules",
      "pnpm",
      "package.json",
    );
    await mkdir(dirname(unpacked), { recursive: true });
    await writeFile(unpacked, "{}");
    assert.equal(await physicalBundledPath(virtual), unpacked);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("bubblewrap keeps an AppImage package entry visible after tmp isolation", async (context) => {
  const executor = new SandboxedTaskExecutor();
  if ((await executor.capability()) !== "bubblewrap") {
    context.skip("bubblewrap is unavailable");
    return;
  }
  const workspace = await mkdtemp(join(tmpdir(), "blame-bwrap-workspace-"));
  const packageRoot = await mkdtemp(join(tmpdir(), ".mount_Blame-test-"));
  try {
    const entry = join(packageRoot, "manager.cjs");
    await writeFile(entry, "process.stdout.write('manager-ok')\n");
    const executable = await resolveStableNodeExecutable();
    assert.ok(executable);
    const result = await executor.execute({
      args: [entry],
      cwd: workspace,
      executable,
      network: "deny",
      outputBytes: 10_000,
      overlayRoot: workspace,
      readonlyRoots: [packageRoot],
      timeoutMs: 5_000,
    });
    assert.equal(result.status, "passed", result.stderr);
    assert.equal(result.stdout, "manager-ok");
  } finally {
    await rm(workspace, { force: true, recursive: true });
    await rm(packageRoot, { force: true, recursive: true });
  }
});

test("Portfolio V4 pnpm resolves through controlled same-major compatibility", async () => {
  const manager = await resolvePackageManager({
    compatibility: "pnpm_same_major",
    name: "pnpm",
    version: "10.32.1",
  });
  assert.equal(manager.requestedVersion, "10.32.1");
  assert.equal(manager.resolvedVersion.split(".")[0], "10");
  assert.doesNotMatch(manager.executable, /corepack/iu);
  assert.ok(
    ["compatible_same_major", "exact"].includes(manager.resolutionStrategy),
  );
});

test("package manager compatibility never crosses pnpm majors or ecosystems", () => {
  const compatibility = "pnpm_same_major" as const;
  assert.equal(
    packageManagerVersionsCompatible({
      candidateVersion: "10.33.2",
      compatibility,
      name: "pnpm",
      requestedVersion: "10.32.1",
    }),
    true,
  );
  assert.equal(
    packageManagerVersionsCompatible({
      candidateVersion: "11.0.0",
      compatibility,
      name: "pnpm",
      requestedVersion: "10.32.1",
    }),
    false,
  );
  assert.equal(
    packageManagerVersionsCompatible({
      candidateVersion: "10.33.2",
      compatibility,
      name: "npm",
      requestedVersion: "10.32.1",
    }),
    false,
  );
  assert.equal(
    packageManagerVersionsCompatible({
      candidateVersion: "10.33.2-rc.1",
      compatibility,
      name: "pnpm",
      requestedVersion: "10.32.1",
    }),
    false,
  );
  assert.equal(
    packageManagerVersionsCompatible({
      candidateVersion: "10.33.2",
      compatibility,
      name: "pnpm",
      requestedVersion: "010.32.1",
    }),
    false,
  );
});

test(
  "nested package scripts reuse the resolved manager without Corepack",
  { skip: process.platform === "win32" },
  async () => {
    await withWorkspace(async (root, workspace) => {
      const fakeBin = join(root, "fake-bin");
      const previousPath = process.env.PATH;
      await mkdir(join(root, "apps", "web"), { recursive: true });
      await mkdir(fakeBin, { recursive: true });
      await writeFile(
        join(fakeBin, "pnpm"),
        '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 0.0.1; exit 0; fi\necho inherited-pnpm-was-used >&2\nexit 41\n',
      );
      await chmod(join(fakeBin, "pnpm"), 0o755);
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.32.1",
          scripts: { build: "pnpm --filter web build" },
        }),
      );
      await writeFile(
        join(root, "apps", "web", "package.json"),
        JSON.stringify({
          name: "web",
          scripts: { build: "node -e \"process.stdout.write('build-ok')\"" },
        }),
      );
      await writeFile(
        join(root, "pnpm-workspace.yaml"),
        "packages:\n  - apps/*\n",
      );
      process.env.PATH = `${fakeBin}${delimiter}${previousPath ?? ""}`;
      try {
        const revision = success(await workspace.workspaceState()).data
          .source_revision.source_revision_id;
        const run = success(
          await workspace.runTask({
            source_revision_id: revision,
            task: { task_id: "build" },
            limits: { timeout_ms: 30_000 },
          }),
        );
        assert.equal(run.data.status, "passed", JSON.stringify(run.data));
        assert.equal(run.data.outcome, "passed");
        assert.doesNotMatch(run.data.execution.argv.join(" "), /corepack/iu);
        assert.deepEqual(run.data.execution.package_manager_resolution, {
          name: "pnpm",
          requested_version: "10.32.1",
          resolved_version: "10.33.2",
          strategy: "compatible_same_major",
        });
      } finally {
        process.env.PATH = previousPath;
      }
    });
  },
);

test("preview log reads always observe the current runtime state", async () => {
  const governor = new ExternalReadGovernor();
  let executions = 0;
  const tool = governor.wrap({
    name: "get_preview_container_logs",
    description: "logs",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return { available: true, logs: "ready" };
    },
  });
  const context = {} as never;
  await tool.execute({ service: "web", tailLines: 120 }, context);
  const duplicate = await tool.execute(
    { service: "web", tailLines: 120 },
    context,
  );
  assert.equal(executions, 2);
  assert.equal(
    (duplicate as { alreadyAvailable?: boolean }).alreadyAvailable,
    undefined,
  );
  governor.newUserRequest();
  await tool.execute({ service: "web", tailLines: 120 }, context);
  assert.equal(executions, 3);
});

test("unavailable preview reads can observe a lifecycle transition", async () => {
  const governor = new ExternalReadGovernor();
  let executions = 0;
  const tool = governor.wrap({
    name: "get_preview_devtools",
    description: "preview",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return { available: false, reason: "PREVIEW_NOT_READY" };
    },
  });
  const first = await tool.execute({}, {} as never);
  const duplicate = await tool.execute({}, {} as never);
  assert.equal((first as { outcome?: string }).outcome, "unavailable");
  assert.equal(executions, 2);
  assert.equal(
    (duplicate as { alreadyAvailable?: boolean }).alreadyAvailable,
    undefined,
  );
});

test("large web fetch results retain the Cline result envelope", async () => {
  const governor = new ExternalReadGovernor();
  const hooks = governor.fetchHooks();
  assert.ok(hooks.afterTool);
  const result = await hooks.afterTool({
    durationMs: 10,
    endedAt: new Date(),
    input: { requests: [{ url: "https://example.com/large" }] },
    result: {
      output: [
        {
          query: "https://example.com/large",
          result: "large content ".repeat(2_000),
          success: true,
        },
      ],
      isError: false,
      metadata: { requestId: "fetch-request" },
    },
    snapshot: {},
    startedAt: new Date(),
    tool: { name: "fetch_web_content" },
    toolCall: {},
  } as never);
  const governed = result?.result as {
    isError: boolean;
    metadata: Record<string, unknown>;
    output: Array<{ query: string; result: string; success: boolean }>;
  };
  assert.ok(Array.isArray(governed.output));
  assert.equal(governed.output.length, 1);
  assert.equal(governed.output[0]?.success, true);
  assert.equal(governed.isError, false);
  assert.equal(governed.metadata.requestId, "fetch-request");
  assert.equal(governed.metadata.externalReadTruncated, true);
  assert.ok((governed.output[0]?.result.length ?? 0) < 28_000);
  assert.ok(Buffer.byteLength(JSON.stringify(governed), "utf8") <= 16_000);
  const continuation = governed.metadata.externalReadContinuation as {
    receipt_id: string;
  };
  assert.match(continuation.receipt_id, /^external-read:\/\//u);
  const inspected = await governor
    .receiptTool()
    .execute(
      { receipt_id: continuation.receipt_id, max_bytes: 1_024 },
      {} as never,
    );
  assert.equal(
    (inspected as { reason?: string }).reason,
    "EXTERNAL_READ_RECEIPT_INSPECTED",
  );
  assert.equal(
    (inspected as { returned_bytes?: number }).returned_bytes,
    1_024,
  );
});

test("an unavailable mutation capability does not suppress distinct research", async () => {
  const governor = new ExternalReadGovernor();
  const context = {} as never;
  const tool = governor.wrap({
    name: "workspace_state",
    description: "state",
    inputSchema: { type: "object" },
    execute: async () => ({
      outcome: "unavailable",
      data: {
        capabilities: {
          execution: {
            dependency_mutation: {
              available: false,
              capability: "dependency_mutation",
              status: "unavailable",
            },
          },
        },
      },
    }),
  } as never);
  await tool.execute({}, context);
  const hooks = governor.fetchHooks();
  assert.ok(hooks.beforeTool);
  assert.ok(hooks.afterTool);
  const toolCall = { toolCallId: "cline-skipped-fetch" };
  const input = { query: "pnpm add package" };
  const skipped = await hooks.beforeTool({
    input,
    snapshot: {},
    tool: { name: "fetch_web_content" },
    toolCall,
  } as never);
  assert.equal(skipped, undefined);

  const restored = await hooks.afterTool({
    input,
    result: {
      isError: false,
      output: [{ result: "documentation", success: true }],
    },
    snapshot: {},
    tool: { name: "fetch_web_content" },
    toolCall,
  } as never);
  const result = restored?.result;
  assert.equal(result?.isError, false);
  assert.equal(Array.isArray(result?.output), true);
});

test("parallel identical reactive reads share one execution", async () => {
  let executions = 0;
  const governor = new ExternalReadGovernor();
  const tool = governor.wrap({
    name: "get_preview_container_logs",
    description: "logs",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { output: "logs" };
    },
  } as never);
  const [first, second] = await Promise.all([
    tool.execute({ service: "app" }, {} as never),
    tool.execute({ service: "app" }, {} as never),
  ]);
  assert.equal(executions, 1);
  assert.equal((first as { output?: string }).output, "logs");
  assert.equal((second as { output?: string }).output, "logs");
});

test("reactive read continuations remain inspectable without caching state", async () => {
  let executions = 0;
  const governor = new ExternalReadGovernor();
  const tool = governor.wrap({
    name: "get_preview_container_logs",
    description: "logs",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return { available: true, logs: "preview log ".repeat(2_000) };
    },
  });
  const first = (await tool.execute({}, {} as never)) as {
    continuation: { receipt_id: string };
  };
  const inspected = await governor
    .receiptTool()
    .execute(
      { receipt_id: first.continuation.receipt_id, max_bytes: 1_024 },
      {} as never,
    );
  await tool.execute({}, {} as never);

  assert.equal(executions, 2);
  assert.equal((inspected as { outcome?: string }).outcome, "completed");
});

test("semantically similar external resources remain independently accessible", async () => {
  const governor = new ExternalReadGovernor();
  let executions = 0;
  const tool = governor.wrap({
    name: "get_preview_container_logs",
    description: "logs",
    inputSchema: { type: "object" },
    execute: async () => {
      executions += 1;
      return { available: true, logs: "ready" };
    },
  });
  const context = {} as never;
  await tool.execute({ service: "web", tailLines: 100 }, context);
  await tool.execute({ service: "web", tailLines: 120 }, context);
  const third = await tool.execute({ service: "web", tailLines: 140 }, context);
  assert.equal(executions, 3);
  assert.equal((third as { outcome?: string }).outcome, "completed");
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
    const run = await workspace.runTask({
      source_revision_id: revision.source_revision_id,
      task: { task_id: "build" },
      limits: { timeout_ms: 10_000 },
    });
    assert.equal(run.status, "error");
    if (run.status !== "error") return;
    const summary = run.error.recovery as {
      outcome: string;
      status: string;
      stderr_summary: string;
    };
    assert.equal(run.error.code, "EXECUTION_ERROR");
    assert.equal(summary.status, "execution_error");
    assert.equal(summary.outcome, "infrastructure_error");
    assert.match(summary.stderr_summary, /Corepack failed/);
    assert.match(run.recommendation, /Do not edit project files/iu);
  });
});

test("package registry bootstrap failures are infrastructure errors", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root, {
      taskExecutor: {
        async capability() {
          return "worktree";
        },
        async execute() {
          return {
            status: "failed",
            exitCode: 1,
            signal: null,
            stdout: "",
            stderr: "[ERROR] GET https://registry.npmjs.org/pnpm: fetch failed",
            outputTruncated: false,
            isolation: "worktree",
          };
        },
      },
    });
    const revision = success(await workspace.workspaceState()).data
      .source_revision;
    const run = await workspace.runTask({
      source_revision_id: revision.source_revision_id,
      task: { task_id: "build" },
      limits: { timeout_ms: 10_000 },
    });
    assert.equal(run.status, "error");
    if (run.status !== "error") return;
    const summary = run.error.recovery as { outcome: string; status: string };
    assert.equal(summary.status, "execution_error");
    assert.equal(summary.outcome, "infrastructure_error");
    assert.match(run.recommendation, /Do not edit project files/iu);
  });
});

test("run_task reports executor health failures without executing commands", async () => {
  await withWorkspace(async (root) => {
    let executions = 0;
    let healthChecks = 0;
    const executor: TaskExecutor = {
      async capability() {
        return "bubblewrap";
      },
      async healthCheck() {
        healthChecks += 1;
        return {
          available: false,
          isolation: "bubblewrap",
          stderr:
            "bwrap: execvp /tmp/.mount_Blame123/@blamedesktop: No such file or directory",
        };
      },
      async execute() {
        executions += 1;
        return corepackFailureExecutor.execute({} as TaskExecutionInput);
      },
    };
    const workspace = new SemanticWorkspace(root, { taskExecutor: executor });
    const revision = success(await workspace.workspaceState()).data
      .source_revision.source_revision_id;
    const terminal = await workspace.runTask(
      {
        source_revision_id: revision,
        task: { task_id: "build" },
        limits: { timeout_ms: 10_000 },
      },
      undefined,
      { sessionId: "health-session", toolCallId: "health-call" },
    );
    assert.ok(healthChecks >= 1);
    assert.equal(executions, 0);
    assert.equal(terminal.status, "error");
    if (terminal.status !== "error") return;
    const summary = terminal.error.recovery as { stderr_summary: string };
    assert.match(summary.stderr_summary, /bwrap: execvp/);
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

function successfulResult<T>(data: T) {
  return harnessSuccess({
    data,
    revision: {},
    startedAt: Date.now(),
    provenance: [],
  });
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

const invalidImport =
  'import { ArrowLeft, ArrowRight, ExternalLink } from "lucide-react"; from "lucide-react";\n';

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

const singleFilePatch = [
  "--- a/first.txt",
  "+++ b/first.txt",
  "@@ -1 +1 @@",
  "-first",
  "+changed first",
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
