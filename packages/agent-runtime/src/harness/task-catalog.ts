import { access, readFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import fg from "fast-glob";
import type { RunTaskInput, TaskCatalogItem } from "./schemas.js";

export type TaskInvocation = {
  executable: string;
  args: string[];
  cwd: string;
  packageManagerVersion?: string;
};

type PackageManagerSelection = {
  name: TaskCatalogItem["package_manager"];
  version?: string;
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
  return [
    dependencyTask(packageManager),
    ...disambiguateTasks(candidates),
  ].sort((left, right) => left.task_id.localeCompare(right.task_id));
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
  if (task.kind === "dependencies") return dependencyInvocation(task);
  const selected = task.supportsFileSelection
    ? selectedTaskPaths(task.cwd, selection)
    : [];
  const forwarded = selected.length ? ["--", ...selected] : [];
  const script = task.script ?? task.task_id;
  switch (task.package_manager) {
    case "bun":
      return taskCommand(
        "bun",
        ["run", script, ...forwarded],
        task.cwd,
        task.package_manager_version,
      );
    case "pnpm":
      return taskCommand(
        "pnpm",
        ["run", script, ...forwarded],
        task.cwd,
        task.package_manager_version,
      );
    case "yarn":
      return taskCommand(
        "yarn",
        ["run", script, ...forwarded],
        task.cwd,
        task.package_manager_version,
      );
    default:
      return taskCommand(
        "npm",
        ["run", script, ...forwarded],
        task.cwd,
        task.package_manager_version,
      );
  }
}

function dependencyTask(
  packageManager: PackageManagerSelection,
): TaskCatalogItem {
  const invocation = dependencyInvocation({
    package_manager: packageManager.name,
    ...(packageManager.version
      ? { package_manager_version: packageManager.version }
      : {}),
  });
  return {
    task_id: "dependencies",
    kind: "dependencies",
    command: [invocation.executable, ...invocation.args].join(" "),
    cwd: ".",
    package_manager: packageManager.name,
    ...(packageManager.version
      ? { package_manager_version: packageManager.version }
      : {}),
    supportsFileSelection: false,
    requiresNetwork: true,
    dependencyPolicy: "required",
  };
}

function dependencyInvocation(
  task: Pick<TaskCatalogItem, "package_manager" | "package_manager_version">,
) {
  if (task.package_manager === "pnpm")
    return taskCommand(
      "pnpm",
      ["install", "--frozen-lockfile", "--prefer-offline"],
      ".",
      task.package_manager_version,
    );
  if (task.package_manager === "yarn")
    return taskCommand(
      "yarn",
      ["install", "--immutable", "--cached"],
      ".",
      task.package_manager_version,
    );
  if (task.package_manager === "bun")
    return taskCommand(
      "bun",
      ["install", "--frozen-lockfile"],
      ".",
      task.package_manager_version,
    );
  return taskCommand(
    "npm",
    ["ci", "--prefer-offline", "--no-audit", "--no-fund"],
    ".",
    task.package_manager_version,
  );
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
  packageManager: PackageManagerSelection,
): CatalogCandidate[] {
  const cwd = dirname(manifest.file).replaceAll("\\", "/");
  const label = packageLabel(manifest, cwd);
  return Object.entries(manifest.scripts)
    .filter(validTask)
    .map(([script, command]) =>
      taskCandidate(packageManager, cwd, label, script, command),
    );
}

function taskCandidate(
  packageManager: PackageManagerSelection,
  cwd: string,
  label: string,
  script: string,
  command: string,
): CatalogCandidate {
  const kind = taskKind(script, command);
  return {
    task_id: cwd === "." ? script : `${label}:${script}`,
    candidateId: cwd === "." ? script : `${label}:${script}`,
    pathId: cwd === "." ? script : `${cwd}:${script}`,
    script,
    kind,
    command,
    cwd,
    package_manager: packageManager.name,
    ...(packageManager.version
      ? { package_manager_version: packageManager.version }
      : {}),
    supportsFileSelection: kind === "test",
    requiresNetwork: false,
    dependencyPolicy: taskDependencyPolicy(kind),
  };
}

function taskDependencyPolicy(kind: TaskCatalogItem["kind"]) {
  return kind === "custom" || kind === "service"
    ? ("optional" as const)
    : ("required" as const);
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

function taskCommand(
  executable: string,
  args: string[],
  cwd: string,
  packageManagerVersion?: string,
) {
  return {
    executable,
    args,
    cwd,
    ...(packageManagerVersion ? { packageManagerVersion } : {}),
  };
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
): Promise<PackageManagerSelection> {
  const [name, version] = declaredPackageManager(declared);
  if (name === "bun" || name === "npm" || name === "pnpm" || name === "yarn")
    return { name, ...(version ? { version } : {}) };
  for (const [file, manager] of packageManagerFiles) {
    if (await fileExists(join(root, file))) return { name: manager };
  }
  return { name: "npm" };
}

function declaredPackageManager(value?: string) {
  const match = value
    ?.trim()
    .match(/^(bun|npm|pnpm|yarn)@([^+\s]+)(?:\+.*)?$/u);
  return match ? [match[1], match[2]] : [value?.split("@", 1)[0], undefined];
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
