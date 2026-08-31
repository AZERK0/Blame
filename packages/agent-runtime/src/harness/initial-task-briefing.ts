import { lightCapabilityDescription } from "./light-capabilities.js";
import type { LightTaskContract } from "./light-contracts.js";
import type { LightWorkspaceExecutor } from "./light-executor.js";
import { readTaskCatalog } from "./task-catalog.js";
import { WorkspaceFiles, languageName } from "./workspace-files.js";
import { resolvePackageManager } from "./package-manager-runtime.js";

type InitialTaskBriefingInput = {
  executor?: LightWorkspaceExecutor;
  taskContract?: LightTaskContract;
  workspaceRoot: string;
};

export async function createInitialTaskBriefing(
  input: InitialTaskBriefingInput,
) {
  if (input.executor) return remoteBriefing(input);
  try {
    return await localBriefing(input);
  } catch {
    return undefined;
  }
}

async function localBriefing(input: InitialTaskBriefingInput) {
  const files = new WorkspaceFiles(input.workspaceRoot);
  const snapshot = await files.snapshot();
  const tasks = await readTaskCatalog(input.workspaceRoot, snapshot.files);
  const dependencyTask = tasks.find(({ kind }) => kind === "dependencies");
  const packages = snapshot.files.filter((path) =>
    path.endsWith("package.json"),
  );
  const candidates = briefingCandidates(
    snapshot.files,
    snapshot.changes.map(({ path }) => path),
    input.taskContract?.objective,
  );
  return briefingLines({
    candidates,
    manager: dependencyTask?.package_manager,
    managerAvailability: await packageManagerAvailability(dependencyTask),
    packages,
    snapshot,
    tasks,
  }).join("\n");
}

type BriefingFacts = {
  candidates: string[];
  manager?: string;
  managerAvailability: string;
  packages: string[];
  snapshot: Awaited<ReturnType<WorkspaceFiles["snapshot"]>>;
  tasks: Awaited<ReturnType<typeof readTaskCatalog>>;
};

function briefingLines(input: BriefingFacts) {
  const scripts = input.tasks
    .filter(({ kind }) => kind !== "dependencies")
    .slice(0, 16)
    .map(({ task_id }) => task_id)
    .join(", ");
  const git = input.snapshot.git
    ? `branch ${input.snapshot.branch || "detached"}; ${input.snapshot.changes.length} changed path(s)`
    : "not detected";
  return [
    `Project: ${projectDescription(input.snapshot.files)}.`,
    `Packages: ${input.packages.slice(0, 12).join(", ") || "none detected"}.`,
    `Package manager: ${input.manager ?? "not detected"}; ${input.managerAvailability}.`,
    `Scripts: ${scripts || "none detected"}.`,
    `Git: ${git}.`,
    lightCapabilityDescription(),
    ...(input.candidates.length
      ? [`Likely targets: ${input.candidates.join(", ")}.`]
      : []),
  ];
}

async function remoteBriefing(input: InitialTaskBriefingInput) {
  const result = await input.executor!({
    input: {},
    taskContract: input.taskContract,
    tool: "initial_task_briefing",
    workspaceRoot: input.workspaceRoot,
  });
  if (result.status !== "ok") return undefined;
  const data = result.data as { briefing?: unknown };
  return typeof data.briefing === "string" ? data.briefing : undefined;
}

async function packageManagerAvailability(
  task: Awaited<ReturnType<typeof readTaskCatalog>>[number] | undefined,
) {
  if (!task) return "not detected";
  try {
    const manager = await resolvePackageManager({
      name: task.package_manager,
      version: task.package_manager_version,
      compatibility:
        task.package_manager === "pnpm" ? "pnpm_same_major" : undefined,
    });
    return `available (${manager.resolvedVersion})`;
  } catch {
    return "executable unavailable";
  }
}

export function appendInitialTaskBriefing(
  systemPrompt: string,
  briefing: string | undefined,
) {
  if (!briefing) return systemPrompt;
  return `${systemPrompt}\n\n<task_briefing>\n${briefing}\n</task_briefing>`;
}

function projectDescription(paths: string[]) {
  const languages = new Map<string, number>();
  for (const path of paths) {
    const language = languageName(path);
    if (language === "unknown") continue;
    languages.set(language, (languages.get(language) ?? 0) + 1);
  }
  const dominant = [...languages]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 4)
    .map(([language, count]) => `${language} (${count})`);
  return `${paths.length} files; ${dominant.join(", ") || "text/configuration"}`;
}

function briefingCandidates(
  paths: string[],
  changedPaths: string[],
  objective?: string,
) {
  const terms = objectiveTerms(objective);
  const changed = new Set(changedPaths);
  return paths
    .filter(
      (path) =>
        !/(?:^|\/)(?:dist|migrations?|node_modules)(?:\/|$)/u.test(path),
    )
    .map((path) => ({
      path,
      score: candidateScore(path, terms, changed.has(path)),
    }))
    .filter(({ score }) => score >= 10)
    .sort(
      (left, right) =>
        right.score - left.score || left.path.localeCompare(right.path),
    )
    .slice(0, 5)
    .map(({ path }) => path);
}

function objectiveTerms(objective?: string) {
  return [
    ...new Set(
      (objective ?? "")
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}_-]{4,}/gu) ?? [],
    ),
  ].slice(0, 30);
}

function candidateScore(path: string, terms: string[], changed: boolean) {
  const normalized = path.toLocaleLowerCase();
  return terms.reduce(
    (score, term) => score + (normalized.includes(term) ? 10 : 0),
    changed ? 20 : 0,
  );
}
