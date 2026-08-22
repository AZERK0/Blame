import { access, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import fg from "fast-glob";
import type { RunTaskInput, TaskCatalogItem } from "./schemas.js";

export type TaskInvocation = {
  executable: string;
  args: string[];
  cwd: string;
};

type PackageManifest = {
  file: string;
  name?: string;
  packageManager?: string;
  scripts: Record<string, string>;
};

type CatalogCandidate = TaskCatalogItem & {
  candidateId: string;
  pathId: string;
};

export async function readTaskCatalog(
  root: string,
  workspaceFiles?: string[],
): Promise<TaskCatalogItem[]> {
  const manifests = await readPackageManifests(root, workspaceFiles);
  if (!manifests.length) return [];
  const rootManifest = manifests.find(({ file }) => file === "package.json");
  const packageManager = await detectPackageManager(
    root,
    rootManifest?.packageManager,
  );
  const candidates = manifests.flatMap((manifest) =>
    manifestTasks(manifest, packageManager),
  );
  return disambiguateTasks(candidates).sort((left, right) =>
    left.task_id.localeCompare(right.task_id),
  );
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
    ? candidates.filter((task) => taskMatchesTarget(task, requested.target!))
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
  const selected = selectedTaskPaths(task.cwd, selection);
  const forwarded = selected.length ? ["--", ...selected] : [];
  const script = task.script ?? task.task_id;
  switch (task.package_manager) {
    case "bun":
      return taskCommand("bun", ["run", script, ...forwarded], task.cwd);
    case "pnpm":
      return taskCommand("pnpm", ["run", script, ...forwarded], task.cwd);
    case "yarn":
      return taskCommand("yarn", ["run", script, ...forwarded], task.cwd);
    default:
      return taskCommand("npm", ["run", script, ...forwarded], task.cwd);
  }
}

async function readPackageManifests(root: string, workspaceFiles?: string[]) {
  const files = workspaceFiles
    ? workspaceFiles.filter(isPackageManifest)
    : await discoverPackageManifests(root);
  const ordered = files.sort((left, right) => {
    if (left === "package.json") return -1;
    if (right === "package.json") return 1;
    return left.localeCompare(right);
  });
  const manifests = await Promise.all(
    ordered.slice(0, 200).map((file) => readPackageManifest(root, file)),
  );
  return manifests.filter((value): value is PackageManifest => !!value);
}

function discoverPackageManifests(root: string) {
  return fg(["package.json", "**/package.json"], {
    cwd: root,
    onlyFiles: true,
    unique: true,
    ignore: [
      "**/.git/**",
      "**/.blame/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
    ],
  });
}

function isPackageManifest(path: string) {
  return path === "package.json" || path.endsWith("/package.json");
}

async function readPackageManifest(
  root: string,
  file: string,
): Promise<PackageManifest | undefined> {
  try {
    const value = JSON.parse(await readFile(join(root, file), "utf8")) as {
      name?: string;
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    return {
      file,
      scripts: value.scripts ?? {},
      ...(value.name ? { name: value.name } : {}),
      ...(value.packageManager ? { packageManager: value.packageManager } : {}),
    };
  } catch {
    return undefined;
  }
}

function manifestTasks(
  manifest: PackageManifest,
  packageManager: TaskCatalogItem["package_manager"],
): CatalogCandidate[] {
  const cwd = dirname(manifest.file).replaceAll("\\", "/");
  const label = packageLabel(manifest, cwd);
  return Object.entries(manifest.scripts)
    .filter(validTask)
    .map(([script, command]) => ({
      task_id: cwd === "." ? script : `${label}:${script}`,
      candidateId: cwd === "." ? script : `${label}:${script}`,
      pathId: cwd === "." ? script : `${cwd}:${script}`,
      script,
      kind: taskKind(script, command),
      command,
      cwd,
      package_manager: packageManager,
    }));
}

function disambiguateTasks(candidates: CatalogCandidate[]) {
  const counts = new Map<string, number>();
  for (const task of candidates)
    counts.set(task.candidateId, (counts.get(task.candidateId) ?? 0) + 1);
  return candidates.map(({ candidateId, pathId, ...task }) => ({
    ...task,
    task_id: counts.get(candidateId) === 1 ? candidateId : pathId,
  }));
}

function packageLabel(manifest: PackageManifest, cwd: string) {
  const declared = manifest.name?.split("/").at(-1)?.trim();
  return declared || basename(cwd);
}

function taskMatchesTarget(task: TaskCatalogItem, target: string) {
  const normalized = target.replaceAll("\\", "/");
  return (
    task.task_id === target ||
    task.task_id.startsWith(`${target}:`) ||
    task.cwd === normalized ||
    basename(task.cwd) === target
  );
}

function selectedTaskPaths(cwd: string, selection?: RunTaskInput["selection"]) {
  const selected = [...(selection?.tests ?? []), ...(selection?.files ?? [])];
  if (cwd === ".") return selected;
  const prefix = `${cwd}/`;
  return selected.map((path) =>
    path.replaceAll("\\", "/").startsWith(prefix)
      ? path.replaceAll("\\", "/").slice(prefix.length)
      : path,
  );
}

function taskCommand(executable: string, args: string[], cwd: string) {
  return { executable, args, cwd };
}

function validTask([taskId, command]: [string, string]) {
  return (
    Boolean(taskId.trim()) &&
    taskId.length <= 300 &&
    Boolean(command.trim()) &&
    command.length <= 2_000
  );
}

async function detectPackageManager(
  root: string,
  declared?: string,
): Promise<TaskCatalogItem["package_manager"]> {
  const name = declared?.split("@", 1)[0];
  if (name === "bun" || name === "npm" || name === "pnpm" || name === "yarn")
    return name;
  for (const [file, manager] of packageManagerFiles) {
    if (await fileExists(join(root, file))) return manager;
  }
  return "npm";
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const packageManagerFiles = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
] as const;

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
