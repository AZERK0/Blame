import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import cacache from "cacache";
import test from "node:test";
import { ArtifactStore } from "./artifact-store.js";
import { semanticWorkspaceTools } from "./cline-tools.js";
import { SemanticWorkspace } from "./semantic-workspace.js";
import type { HarnessToolResult, HarnessToolSuccess } from "./protocol.js";
import type {
  TaskExecutionInput,
  TaskExecutionResult,
  TaskExecutor,
} from "./task-executor.js";

const execFileAsync = promisify(execFile);

test("semantic tools expose exact outlines and reject stale observations", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
        depth: 3,
      }),
    );
    assert.deepEqual(
      outline.data.items.map((item) => `${item.kind}:${item.qualified_name}`),
      ["class:Greeter", "method:Greeter.greet", "function:formatName"],
    );
    const method = outline.data.items.find(
      (item) => item.qualified_name === "Greeter.greet",
    );
    assert.ok(method);

    const body = success(
      await workspace.inspectCode({
        source_revision_id: revision,
        target: { symbol_ref: method.symbol_ref.ref },
        view: "body",
      }),
    );
    assert.match(body.data.content, /return `Hello/);
    assert.equal(body.data.file_ref.source_revision_id, revision);

    const search = success(
      await workspace.searchCode({
        source_revision_id: revision,
        query: { kind: "text", pattern: "formatName" },
        scope: { paths: ["src"] },
      }),
    );
    assert.equal(search.data.items[0]?.path, "src/service.ts");
    assert.equal(search.data.engine, "ripgrep");
    assert.match(search.data.items[0]?.node_ref ?? "", /^node:\/\//);

    const raw = success(
      await workspace.inspectCode({
        source_revision_id: revision,
        target: { path: "package.json" },
        view: "raw",
        budget: { max_output_tokens: 500 },
      }),
    );
    assert.match(raw.data.content, /"typecheck"/);
    assert.match(raw.data.file_ref.blob_hash, /^[a-f0-9]{64}$/);

    await writeFile(
      join(root, "src", "service.ts"),
      source.replace("Hello", "Hi"),
    );
    const stale = await workspace.inspectCode({
      source_revision_id: revision,
      target: { symbol_ref: method.symbol_ref.ref },
      view: "body",
    });
    assert.equal(stale.status, "error");
    if (stale.status === "error")
      assert.equal(stale.error.code, "STALE_REVISION");
  });
});

test("security reads redact credential values while preserving source handles", async () => {
  await withWorkspace(async (root) => {
    const secret = `ghp_${"A".repeat(24)}`;
    await writeFile(
      join(root, "src", "credentials.ts"),
      `export const token = "${secret}";\n`,
    );
    await execFileAsync("git", ["add", "src/credentials.ts"], { cwd: root });
    await execFileAsync("git", ["commit", "-m", "add credential fixture"], {
      cwd: root,
    });
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const inspectTool = semanticWorkspaceTools(root, {
      redactSensitiveContent: true,
    }).find((tool) => tool.name === "inspect_code");
    assert.ok(inspectTool);
    const raw = await inspectTool.execute(
      {
        source_revision_id: revision,
        target: { path: "src/credentials.ts" },
        view: "raw",
      },
      { agentId: "test", iteration: 1 },
    );
    const serialized = JSON.stringify(raw);
    assert.match(serialized, /REDACTED_SECRET/);
    assert.doesNotMatch(serialized, new RegExp(secret));
    assert.match(serialized, /[a-f0-9]{64}/);
  });
});

test("apply_change proposes, reviews, and atomically commits an exact node edit", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);

    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "replace-format-name",
        operations: [
          {
            kind: "replace_node",
            target: target.node_ref.ref,
            replacement:
              "function formatName(value: string) {\n  return value.trim().toUpperCase();\n}",
          },
        ],
        checks: ["parse"],
      }),
    );
    assert.match(proposed.data.proposal_ref, /^change-proposal:\/\//);
    const proposalPath = storedProposalPath(root, proposed.data.proposal_ref);
    const persisted = JSON.parse(await readFile(proposalPath, "utf8")) as {
      changes: Array<Record<string, unknown>>;
      content_hash: string;
    };
    assert.match(persisted.content_hash, /^[a-f0-9]{64}$/);
    assert.equal("old_content" in persisted.changes[0]!, false);
    assert.equal("new_content" in persisted.changes[0]!, false);
    assert.match(
      String(
        (persisted.changes[0]?.old_artifact as { ref?: string } | undefined)
          ?.ref,
      ),
      /^artifact:\/\//,
    );
    assert.equal(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      source,
    );

    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposed.data.proposal_ref,
      }),
    );
    assert.match(review.data.diff, /toUpperCase/);
    assert.deepEqual(review.data.checks_not_run, [
      "lint",
      "typecheck",
      "tests",
    ]);
    assert.equal(review.data.stale, false);
    assert.deepEqual(review.data.symbol_changes[0]?.modified, [
      "function:formatName",
    ]);

    const idempotencyConflict = await workspace.applyChange({
      action: "propose",
      base_source_revision_id: revision,
      idempotency_key: "replace-format-name",
      operations: [
        { kind: "create_file", path: "src/other.ts", content: "export {};\n" },
      ],
    });
    assert.equal(idempotencyConflict.status, "error");
    if (idempotencyConflict.status === "error")
      assert.equal(idempotencyConflict.error.code, "PRECONDITION_FAILED");

    const committed = success(
      await workspace.applyChange({
        action: "commit_proposal",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "commit-format-name",
      }),
    );
    assert.notEqual(
      committed.data.source_revision.source_revision_id,
      revision,
    );
    assert.match(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      /toUpperCase/,
    );
    if (process.platform !== "win32")
      assert.equal(
        (await stat(join(root, "src", "service.ts"))).mode & 0o777,
        0o755,
      );

    const retried = success(
      await workspace.applyChange({
        action: "commit_proposal",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "commit-format-name",
      }),
    );
    assert.equal(
      retried.data.source_revision.source_revision_id,
      committed.data.source_revision.source_revision_id,
    );
  });
});

test("tool schemas reject contradictory and unknown input before execution", async () => {
  await withWorkspace(async (root) => {
    const tools = semanticWorkspaceTools(root);
    const inspect = tools.find((tool) => tool.name === "inspect_code");
    assert.ok(inspect);
    const invalid = await inspect.execute(
      {
        source_revision_id: "src_00000000000000000000000000000000",
        target: { path: "src/service.ts" },
        view: "body",
        unexpected: true,
      },
      { agentId: "test", iteration: 1 },
    );
    assert.equal((invalid as { isError?: boolean }).isError, true);
    assert.match(JSON.stringify(invalid), /unrecognized|raw view/i);
  });
});

test("persisted proposals are content-addressed and tampering is rejected", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "tamper-proposal",
        operations: [
          { kind: "create_file", path: "src/safe.ts", content: "export {};\n" },
        ],
      }),
    );
    const path = storedProposalPath(root, proposed.data.proposal_ref);
    const stored = JSON.parse(await readFile(path, "utf8")) as {
      changes: Array<{ path: string }>;
    };
    stored.changes[0]!.path = ".env";
    await writeFile(path, JSON.stringify(stored));

    const committed = await workspace.applyChange({
      action: "commit_proposal",
      proposal_ref: proposed.data.proposal_ref,
      expected_base_source_revision_id: revision,
      idempotency_key: "tamper-commit",
    });
    assert.equal(committed.status, "error");
    await assert.rejects(readFile(join(root, "src", "safe.ts")));
    await assert.rejects(readFile(join(root, ".env")));
  });
});

test("apply_change rejects metadata and secret paths", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    for (const path of [".env", ".npmrc", ".blame/injected.json"]) {
      const result = await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: `protect-${path}`,
        operations: [{ kind: "create_file", path, content: "secret" }],
      });
      assert.equal(result.status, "error");
      if (result.status === "error")
        assert.equal(result.error.code, "POLICY_DENIED");
    }
  });
});

test("separate workspace instances serialize concurrent commits", async () => {
  await withWorkspace(async (root) => {
    const first = new SemanticWorkspace(root);
    const second = new SemanticWorkspace(root);
    const state = success(await first.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const proposals = await Promise.all([
      first.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "concurrent-first",
        operations: [
          {
            kind: "create_file",
            path: "src/first.ts",
            content: "export {};\n",
          },
        ],
      }),
      second.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "concurrent-second",
        operations: [
          {
            kind: "create_file",
            path: "src/second.ts",
            content: "export {};\n",
          },
        ],
      }),
    ]);
    const [firstProposal, secondProposal] = proposals.map(success);
    const results = await Promise.all([
      first.applyChange({
        action: "commit_proposal",
        proposal_ref: firstProposal.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "concurrent-first-commit",
      }),
      second.applyChange({
        action: "commit_proposal",
        proposal_ref: secondProposal.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "concurrent-second-commit",
      }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [
      "error",
      "success",
    ]);
    assert.equal(
      (await exists(join(root, "src", "first.ts"))) +
        (await exists(join(root, "src", "second.ts"))),
      1,
    );
  });
});

test("commit recovery rolls back an interrupted write before retrying", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "recovery-proposal",
        operations: [
          {
            kind: "create_file",
            path: "src/recovered.ts",
            content: "export const recovered = true;\n",
          },
        ],
      }),
    );
    const stored = JSON.parse(
      await readFile(
        storedProposalPath(root, proposed.data.proposal_ref),
        "utf8",
      ),
    ) as {
      changes: Array<{
        path: string;
        new_artifact: { ref: string };
      }>;
    };
    const artifact = new ArtifactStore(root);
    const partiallyWritten = await artifact.get(
      stored.changes[0]!.new_artifact.ref,
    );
    await writeFile(join(root, "src", "recovered.ts"), partiallyWritten);
    const journalDirectory = join(root, ".blame", "harness", "journals");
    await mkdir(journalDirectory, { recursive: true });
    await writeFile(
      join(journalDirectory, "active.json"),
      JSON.stringify({
        schema_version: "1.0",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "recovery-commit",
        changed_files: ["src/recovered.ts"],
        created_at: new Date().toISOString(),
      }),
    );

    const committed = success(
      await workspace.applyChange({
        action: "commit_proposal",
        proposal_ref: proposed.data.proposal_ref,
        expected_base_source_revision_id: revision,
        idempotency_key: "recovery-commit",
      }),
    );
    assert.deepEqual(committed.data.changed_files, ["src/recovered.ts"]);
    assert.equal(
      await readFile(join(root, "src", "recovered.ts"), "utf8"),
      "export const recovered = true;\n",
    );
    await assert.rejects(readFile(join(journalDirectory, "active.json")));
  });
});

test("review_change emits multi-hunk diffs and binary summaries", async () => {
  await withWorkspace(async (root) => {
    const lines = Array.from({ length: 30 }, (_, index) => `line-${index}\n`);
    const text = lines.join("");
    await writeFile(join(root, "src", "many.ts"), text);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "many lines"]);
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const expectedHash = await fileDigest(join(root, "src", "many.ts"));
    const first = Buffer.byteLength(lines.slice(0, 2).join(""));
    const second = Buffer.byteLength(lines.slice(0, 25).join(""));
    const textProposal = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "multi-hunk-proposal",
        operations: [
          {
            kind: "text_replace",
            path: "src/many.ts",
            expected_blob_hash: expectedHash,
            range_utf8_bytes: [first, first + Buffer.byteLength("line-2")],
            expected_old_text: "line-2",
            replacement: "changed-2",
          },
          {
            kind: "text_replace",
            path: "src/many.ts",
            expected_blob_hash: expectedHash,
            range_utf8_bytes: [second, second + Buffer.byteLength("line-25")],
            expected_old_text: "line-25",
            replacement: "changed-25",
          },
        ],
      }),
    );
    const review = success(
      await workspace.reviewChange({
        proposal_ref: textProposal.data.proposal_ref,
      }),
    );
    assert.ok((review.data.diff.match(/@@/g) ?? []).length >= 4);

    const binaryProposal = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "binary-proposal",
        operations: [
          { kind: "create_file", path: "src/blob.bin", content: "\0binary" },
        ],
      }),
    );
    const binaryReview = success(
      await workspace.reviewChange({
        proposal_ref: binaryProposal.data.proposal_ref,
      }),
    );
    assert.match(binaryReview.data.diff, /Binary files/);
  });
});

test("large diffs expose truncation and an exact artifact continuation", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const content = Array.from(
      { length: 1_500 },
      (_, index) => `export const value${index} = ${index};\n`,
    ).join("");
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: state.data.source_revision.source_revision_id,
        idempotency_key: "large-diff-proposal",
        operations: [
          { kind: "create_file", path: "src/generated.ts", content },
        ],
      }),
    );
    assert.equal(proposed.coverage.truncated, true);
    assert.equal(proposed.data.diff_truncated, true);
    assert.ok((proposed.data.diff_bytes ?? 0) > 12_000);

    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposed.data.proposal_ref,
        budget: { max_output_tokens: 200 },
      }),
    );
    assert.equal(review.coverage.truncated, true);
    const continuation = Number(review.coverage.continuation);
    assert.ok(Number.isInteger(continuation) && continuation > 0);
    const remainder = success(
      await workspace.inspectArtifact({
        artifact_ref: review.data.diff_artifact_ref,
        view: "text",
        offset_bytes: continuation,
        budget: { max_output_tokens: 200 },
      }),
    );
    assert.ok(
      String((remainder.data as unknown as { content: unknown }).content)
        .length > 0,
    );
  });
});

test("artifact reads verify cached content integrity", async () => {
  await withWorkspace(async (root) => {
    const artifacts = new ArtifactStore(root);
    const ref = await artifacts.put("trusted", "text/plain");
    const cache = join(root, ".blame", "harness", "artifacts");
    const info = await cacache.get.info(cache, ref.ref);
    assert.ok(info?.path);
    await writeFile(info.path, "tampered");
    await assert.rejects(artifacts.get(ref.ref));
  });
});

test("run_task isolates writes, captures effects, logs evidence, and is idempotent", async () => {
  await withWorkspace(async (root) => {
    const executor = new RecordingTaskExecutor();
    const workspace = new SemanticWorkspace(root, { taskExecutor: executor });
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    assert.equal(state.data.capabilities.execution.run_task.available, true);

    const input = {
      source_revision_id: revision,
      task: { task_id: "test" },
      limits: { timeout_ms: 10_000 },
      network: "deny" as const,
      idempotency_key: "isolated-test-run",
    };
    const executed = success(await workspace.runTask(input));
    assert.match(executed.data.run_ref, /^run:\/\//);
    assert.equal(executed.data.status, "passed");
    assert.equal(executed.data.filesystem_effects.disposition, "captured");
    assert.match(
      executed.data.filesystem_effects.change_proposal_ref ?? "",
      /^change-proposal:\/\//,
    );
    assert.equal(executed.data.diagnostics[0]?.path, "src/service.ts");
    assert.doesNotMatch(
      executed.data.failures.map(({ message }) => message).join("\n"),
      /supersecretvalue/,
    );
    await assert.rejects(readFile(join(root, "generated.txt")));

    const inspected = success(
      await workspace.inspectRun({
        run_ref: executed.data.run_ref,
        view: "filesystem_effects",
      }),
    );
    assert.deepEqual((inspected.data as { created: string[] }).created, [
      "generated.txt",
    ]);

    const log = success(
      await workspace.inspectArtifact({
        artifact_ref: executed.data.complete_log.ref,
        view: "text",
      }),
    );
    const logContent = String(
      (log.data as unknown as { content: unknown }).content,
    );
    assert.match(logContent, /fixture passed/);
    assert.doesNotMatch(logContent, /supersecretvalue/);

    const proposalRef = executed.data.filesystem_effects.change_proposal_ref;
    assert.ok(proposalRef);
    const review = success(
      await workspace.reviewChange({ proposal_ref: proposalRef }),
    );
    assert.equal(review.data.attached_runs[0]?.run_ref, executed.data.run_ref);
    assert.equal(review.data.checks_not_run.includes("tests"), false);

    const retried = success(await workspace.runTask(input));
    assert.equal(retried.data.run_ref, executed.data.run_ref);
    assert.equal(executor.executions, 1);

    const stored = JSON.parse(
      await readFile(
        join(
          root,
          ".blame",
          "harness",
          "runs",
          `${executed.data.run_ref.slice("run://".length)}.json`,
        ),
        "utf8",
      ),
    ) as { logs: { sealed_raw: { ref: string } } };
    await assert.rejects(
      new ArtifactStore(root).get(stored.logs.sealed_raw.ref, {
        audience: "agent",
      }),
      /access policy/i,
    );
  });
});

test("apply_change can format touched files with the pinned Prettier version", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: state.data.source_revision.source_revision_id,
        idempotency_key: "format-touched-file",
        operations: [
          {
            kind: "create_file",
            path: "src/formatted.ts",
            content: "export const formatted={value:'ok'}",
          },
        ],
        policies: { format: "touched_files", max_touched_files: 1 },
        checks: ["parse"],
      }),
    );
    const review = success(
      await workspace.reviewChange({
        proposal_ref: proposed.data.proposal_ref,
      }),
    );
    assert.equal(review.data.formatting.policy, "touched_files");
    assert.match(review.data.formatting.formatter_version ?? "", /^3\./);
    assert.deepEqual(review.data.formatting.formatted_files, [
      "src/formatted.ts",
    ]);
    assert.match(review.data.diff, /formatted = \{ value: "ok" \}/);
  });
});

test("Cline adapter registers a small read/write harness with strict schemas", async () => {
  await withWorkspace(async (root) => {
    const tools = semanticWorkspaceTools(root);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [
        "workspace_state",
        "search_code",
        "outline_code",
        "inspect_code",
        "apply_change",
        "run_task",
        "inspect_run",
        "review_change",
        "inspect_artifact",
      ],
    );
    assert.equal(
      tools.every((tool) => Boolean(tool.inputSchema)),
      true,
    );
    const stateTool = tools.find((tool) => tool.name === "workspace_state");
    assert.ok(stateTool);
    const result = await stateTool.execute(
      {},
      { agentId: "test", iteration: 1 },
    );
    assert.equal((result as { status?: string }).status, "success");
    const searchTool = tools.find((tool) => tool.name === "search_code");
    assert.ok(searchTool);
    const error = await searchTool.execute(
      {
        source_revision_id: "src_00000000000000000000000000000000",
        query: { kind: "text", pattern: "x" },
      },
      { agentId: "test", iteration: 1 },
    );
    assert.equal((error as { isError?: boolean }).isError, true);
  });
});

test("commit_proposal refuses an unrelated concurrent workspace change", async () => {
  await withWorkspace(async (root) => {
    const workspace = new SemanticWorkspace(root);
    const state = success(await workspace.workspaceState());
    const revision = state.data.source_revision.source_revision_id;
    const outline = success(
      await workspace.outlineCode({
        source_revision_id: revision,
        target: { path: "src/service.ts" },
      }),
    );
    const target = outline.data.items.find(
      (item) => item.qualified_name === "formatName",
    );
    assert.ok(target);
    const proposed = success(
      await workspace.applyChange({
        action: "propose",
        base_source_revision_id: revision,
        idempotency_key: "stale-proposal",
        operations: [
          {
            kind: "replace_node",
            target: target.node_ref.ref,
            replacement:
              "function formatName(value: string) { return value.toUpperCase(); }",
          },
        ],
      }),
    );

    await writeFile(join(root, "README.md"), "concurrent change\n");
    const committed = await workspace.applyChange({
      action: "commit_proposal",
      proposal_ref: proposed.data.proposal_ref,
      expected_base_source_revision_id: revision,
      idempotency_key: "stale-commit",
    });
    assert.equal(committed.status, "error");
    if (committed.status === "error")
      assert.equal(committed.error.code, "STALE_REVISION");
    assert.equal(
      await readFile(join(root, "src", "service.ts"), "utf8"),
      source,
    );
  });
});

test(
  "apply_change refuses write paths whose parent symlink escapes the workspace",
  { skip: process.platform === "win32" },
  async () => {
    await withWorkspace(async (root) => {
      const outside = await mkdtemp(join(tmpdir(), "blame-harness-outside-"));
      try {
        await symlink(outside, join(root, "linked"), "dir");
        const workspace = new SemanticWorkspace(root);
        const state = success(await workspace.workspaceState());
        const revision = state.data.source_revision.source_revision_id;
        const proposed = success(
          await workspace.applyChange({
            action: "propose",
            base_source_revision_id: revision,
            idempotency_key: "symlink-escape-proposal",
            operations: [
              {
                kind: "create_file",
                path: "linked/escaped.ts",
                content: "export {};\n",
              },
            ],
          }),
        );
        const committed = await workspace.applyChange({
          action: "commit_proposal",
          proposal_ref: proposed.data.proposal_ref,
          expected_base_source_revision_id: revision,
          idempotency_key: "symlink-escape-commit",
        });
        assert.equal(committed.status, "error");
        if (committed.status === "error")
          assert.equal(committed.error.code, "POLICY_DENIED");
        await assert.rejects(readFile(join(outside, "escaped.ts")));
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  },
);

const source = `export class Greeter {
  greet(name: string) {
    return \`Hello \${formatName(name)}\`;
  }
}

export function formatName(value: string) {
  return value.trim();
}
`;

async function withWorkspace(operation: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "blame-harness-test-"));
  try {
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        scripts: { test: "node --test", typecheck: "tsc --noEmit" },
      }),
    );
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, "src", "service.ts"), source);
    if (process.platform !== "win32")
      await chmod(join(root, "src", "service.ts"), 0o755);
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "harness@example.com"]);
    await git(root, ["config", "user.name", "Harness Test"]);
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "fixture"]);
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

function storedProposalPath(root: string, ref: string) {
  return join(
    root,
    ".blame",
    "harness",
    "proposals",
    `${ref.slice("change-proposal://".length)}.json`,
  );
}

async function exists(path: string) {
  try {
    await stat(path);
    return 1;
  } catch {
    return 0;
  }
}

async function fileDigest(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function success<T>(result: HarnessToolResult<T>): HarnessToolSuccess<T> {
  if (result.status !== "success") assert.fail(JSON.stringify(result));
  return result;
}

class RecordingTaskExecutor implements TaskExecutor {
  executions = 0;

  async capability() {
    return "sandbox_exec" as const;
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    this.executions += 1;
    await writeFile(join(input.overlayRoot, "generated.txt"), "generated\n");
    return {
      status: "passed",
      exitCode: 0,
      signal: null,
      stdout: `${join(input.overlayRoot, "src", "service.ts")}:2:3 warning fixture passed\nerror token=supersecretvalue\n`,
      stderr: "",
      outputTruncated: false,
      isolation: "sandbox_exec",
    };
  }
}
