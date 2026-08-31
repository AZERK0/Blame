import { executeLightWorkspaceRequest } from "@blame/agent-runtime";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function runAppImageTaskSmoke() {
  const workspace = await mkdtemp(join(tmpdir(), "blame-appimage-task-"));
  try {
    await prepareWorkspace(workspace);
    const result = await executeLightWorkspaceRequest({
      input: {
        kind: "project",
        task: "test",
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

function assertPassed(
  result: Awaited<ReturnType<typeof executeLightWorkspaceRequest>>,
) {
  if (result.status !== "ok") throw new Error(result.message);
  const data = result.data as { exitCode?: number; diagnostic?: string };
  if (data.exitCode === 0) return;
  throw new Error(data.diagnostic ?? `run_task exited with ${data.exitCode}`);
}
