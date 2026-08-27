import { executeSemanticWorkspaceRequest } from "@blame/agent-runtime";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function runAppImageTaskSmoke() {
  const workspace = await mkdtemp(join(tmpdir(), "blame-appimage-task-"));
  try {
    await prepareWorkspace(workspace);
    const sourceRevisionId = await sourceRevision(workspace);
    const result = await executeSemanticWorkspaceRequest({
      input: {
        limits: { timeout_ms: 10_000 },
        network: "deny",
        source_revision_id: sourceRevisionId,
        task: { task_id: "test" },
      },
      tool: "run_task",
      workspaceRoot: workspace,
    });
    assertPassed(result);
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
}

async function prepareWorkspace(workspace: string) {
  await mkdir(join(workspace, "src"), { recursive: true });
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify({
      name: "blame-appimage-task-smoke",
      packageManager: "pnpm@10.33.2",
      scripts: { test: "node -e \"process.stdout.write('appimage-task-ok')\"" },
      version: "1.0.0",
    }),
  );
  await writeFile(join(workspace, "src", "index.js"), "export {}\n");
}

async function sourceRevision(workspace: string) {
  const result = await executeSemanticWorkspaceRequest({
    input: {},
    tool: "workspace_state",
    workspaceRoot: workspace,
  });
  if (result.status !== "success") throw new Error(result.error.message);
  const data = result.data as {
    source_revision?: { source_revision_id?: string };
  };
  const sourceRevisionId = data.source_revision?.source_revision_id;
  if (!sourceRevisionId) throw new Error("AppImage smoke revision is missing");
  return sourceRevisionId;
}

function assertPassed(
  result: Awaited<ReturnType<typeof executeSemanticWorkspaceRequest>>,
) {
  if (result.status !== "success") throw new Error(result.error.message);
  const data = result.data as { status?: string; stderr_summary?: string };
  if (data.status === "passed") return;
  throw new Error(data.stderr_summary ?? `run_task ended with ${data.status}`);
}
