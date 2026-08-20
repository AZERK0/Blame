import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunTaskInput, TaskCatalogItem } from "./schemas.js";

export type TaskInvocation = {
  executable: string;
  args: string[];
  cwd: string;
};

export async function readTaskCatalog(
  root: string,
): Promise<TaskCatalogItem[]> {
  try {
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const packageManager = await detectPackageManager(
      root,
      manifest.packageManager,
    );
    return Object.entries(manifest.scripts ?? {})
      .filter(
        ([taskId, command]) =>
          Boolean(taskId.trim()) &&
          taskId.length <= 300 &&
          Boolean(command.trim()) &&
          command.length <= 2_000,
      )
      .map(([task_id, command]) => ({
        task_id,
        kind: taskKind(task_id, command),
        command,
        cwd: ".",
        package_manager: packageManager,
      }))
      .sort((left, right) => left.task_id.localeCompare(right.task_id));
  } catch {
    return [];
  }
}

export function resolveTask(
  catalog: TaskCatalogItem[],
  requested: RunTaskInput["task"],
) {
  if ("task_id" in requested) {
    const exact = catalog.find((task) => task.task_id === requested.task_id);
    if (!exact)
      throw new Error(
        `Unknown task_id ${requested.task_id}; call workspace_state for the task catalog.`,
      );
    return exact;
  }
  const candidates = catalog.filter((task) => task.kind === requested.kind);
  const targeted = requested.target
    ? candidates.filter(
        (task) =>
          task.task_id === requested.target ||
          task.task_id === `${requested.kind}:${requested.target}`,
      )
    : candidates;
  if (targeted.length === 1) return targeted[0]!;
  if (!targeted.length)
    throw new Error(`No ${requested.kind} task matches the requested target.`);
  throw new Error(
    `Task selection is ambiguous: ${targeted.map(({ task_id }) => task_id).join(", ")}. Use task.task_id.`,
  );
}

export function taskInvocation(
  task: TaskCatalogItem,
  selection?: RunTaskInput["selection"],
): TaskInvocation {
  const selected = [...(selection?.tests ?? []), ...(selection?.files ?? [])];
  const forwarded = selected.length ? ["--", ...selected] : [];
  switch (task.package_manager) {
    case "bun":
      return {
        executable: "bun",
        args: ["run", task.task_id, ...forwarded],
        cwd: task.cwd,
      };
    case "pnpm":
      return {
        executable: "pnpm",
        args: ["run", task.task_id, ...forwarded],
        cwd: task.cwd,
      };
    case "yarn":
      return {
        executable: "yarn",
        args: ["run", task.task_id, ...forwarded],
        cwd: task.cwd,
      };
    default:
      return {
        executable: "npm",
        args: ["run", task.task_id, ...forwarded],
        cwd: task.cwd,
      };
  }
}

async function detectPackageManager(
  root: string,
  declared?: string,
): Promise<TaskCatalogItem["package_manager"]> {
  const name = declared?.split("@", 1)[0];
  if (name === "bun" || name === "npm" || name === "pnpm" || name === "yarn")
    return name;
  for (const [file, manager] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ] as const) {
    try {
      await access(join(root, file));
      return manager;
    } catch {
      // Missing lockfiles are expected while checking alternative package managers.
    }
  }
  return "npm";
}

function taskKind(name: string, command: string): TaskCatalogItem["kind"] {
  if (
    /^(dev|serve|start|watch)(:|$)/i.test(name) ||
    /\b--watch\b/.test(command)
  )
    return "service";
  if (/test/i.test(name)) return "test";
  if (/lint/i.test(name)) return "lint";
  if (/typecheck|check:type/i.test(name)) return "typecheck";
  if (/build/i.test(name)) return "build";
  return "custom";
}
