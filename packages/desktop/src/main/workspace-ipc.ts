import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import {
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import {
  dirname,
  join,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { parse as parseYaml } from "yaml";
import { generateNewProjectWithAgent } from "./agent-ipc";
import {
  containerRuntimeEnvironment,
  createContainerRuntime,
} from "./container-runtime";
import {
  assertHostDependencies,
  checkHostDependencies,
} from "./host-dependencies";
import {
  ensureRuntimeReady,
  getRuntimeStatus,
  repairRuntime,
  resetRuntime,
  uninstallRuntime,
} from "./runtime-manager";
import { setupPath } from "./host-tool-path";
import {
  createProject,
  setNewProjectAgentRuntime,
  setProjectCreationWindowsProvider,
  type CreateProjectInput,
} from "./project-creation";
import {
  collectProjectInitializationDiagnostics,
  type CollectProjectInitializationDiagnosticsInput,
} from "./project-initialization-diagnostics";
import {
  composeWithNonMutatingNpmInstalls,
  composeWithoutNumericSuUser,
  composeWithAllocatedHostPorts,
  dockerComposeWithHostFileMounts,
  dockerComposeForPreview,
  dockerComposeWithPortableWindowsPaths,
} from "./workspace-compose";
import {
  cleanupAbandonedBlamePreviews,
  removeBlamePreviewProjectResources,
  runtimeAddressPoolExhausted,
} from "./workspace-docker-cleanup";
import { envHostFileMounts, syncProjectEnvFiles } from "./workspace-env";
import {
  ensureGitRepository,
  gitDiffBetween,
  isGitRepository,
  listGitDirectory,
  readGitFile,
  type GitDiffInput,
  type GitDirectoryInput,
  type GitFileInput,
} from "./workspace-git";
import {
  appendFile as appendRuntimeFile,
  chmod as chmodRuntime,
  dirnameWorkspacePath,
  joinWorkspacePath,
  mkdir as mkdirRuntime,
  pathExists as runtimePathExists,
  readDirectory as readRuntimeDirectory,
  readFile as readRuntimeFile,
  runtimeManagedPath,
  resolveWorkspacePath as resolveRuntimePath,
  rm as rmRuntime,
  run as runRuntime,
  spawnRuntime,
  storyBranch,
  worktreePath,
  writeFile as writeRuntimeFile,
} from "./workspace-runtime";

const previewStartupIntervalMs = 1_000;
const forceKillDelayMs = 1_500;
const previewResolveTimeoutMs = 45_000;
const composePullRetryDelaysMs = [
  2_000,
  5_000,
  10_000,
  15_000,
  20_000,
  30_000,
  45_000,
  60_000,
];
const composeUpRetryDelaysMs = [2_000, 5_000, 10_000, 15_000];
const globalPreviewVolumes = [
  "blame_bun_cache",
  "blame_corepack_cache",
  "blame_npm_cache",
  "blame_package_store",
  "blame_pnpm_cache",
  "blame_pnpm_store",
  "blame_yarn_cache",
];

type WorkspacePathInput = {
  root: string;
  path?: string;
};

type WorkspaceSearchInput = WorkspacePathInput & {
  query: string;
  limit?: number;
};

type CreateWorktreeInput = {
  repositoryRoot: string;
  storyId: number;
  title: string;
};

type RunProjectSetupInput = {
  worktree: string;
  setupScript: string;
  dockerCompose: string;
};

type CheckHostDependenciesInput = {
  setupScript: string;
  worktree?: string;
};

type StopProjectSetupInput = {
  worktree: string;
};

type ProjectServiceLogsInput = {
  service: string;
  worktree: string;
};

type RemoveWorktreeInput = {
  repositoryRoot: string;
  worktree: string;
};

type ResolveProjectPreviewUrlInput = {
  worktree: string;
};

type ComposeService = {
  depends_on?: Record<string, { condition?: string } | string> | string[];
  labels?: Record<string, string> | string[];
  ports?: Array<{
    mode?: string;
    protocol?: string;
    published?: string | number;
    target?: string | number;
  }>;
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
};

type RuntimeContainer = {
  Config?: {
    Labels?: Record<string, string>;
  };
  NetworkSettings?: {
    Ports?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null
    >;
  };
  Name?: string;
  State?: {
    ExitCode?: number;
    Health?: {
      Status?: string;
    };
    Status?: string;
  };
};

type SetupRun = {
  id: string;
  process: ChildProcessWithoutNullStreams;
  worktree: string;
};

type ProjectLogStream = {
  process?: ChildProcessWithoutNullStreams;
  retry?: NodeJS.Timeout;
  stopped: boolean;
};

type ProjectServiceLogStream = {
  hasOutput: boolean;
  process?: ChildProcessWithoutNullStreams;
  retry?: NodeJS.Timeout;
  service: string;
  stopped: boolean;
  worktree: string;
};

const setupRuns = new Map<string, SetupRun>();
const projectLogStreams = new Map<string, ProjectLogStream>();
const projectServiceLogStreams = new Map<string, ProjectServiceLogStream>();
const previewRecoveries = new Map<string, Promise<string | null>>();
const removingWorktrees = new Set<string>();
const removedWorktrees = new Set<string>();
const workspaceProcesses = new Set<ChildProcessWithoutNullStreams>();
const containerRuntime = createContainerRuntime();

export function registerWorkspaceIpcHandlers() {
  setProjectCreationWindowsProvider(() => BrowserWindow.getAllWindows());
  setNewProjectAgentRuntime({ generate: generateNewProjectWithAgent });
  ipcMain.handle("workspace:path-exists", (_event, input: { path: string }) =>
    pathExists(input.path),
  );
  ipcMain.handle(
    "workspace:list-directory",
    (_event, input: WorkspacePathInput) => listDirectory(input),
  );
  ipcMain.handle("workspace:read-file", (_event, input: WorkspacePathInput) =>
    readWorkspaceFile(input),
  );
  ipcMain.handle(
    "workspace:search-files",
    (_event, input: WorkspaceSearchInput) => searchFiles(input),
  );
  ipcMain.handle("workspace:git-diff", (_event, input: { root: string }) =>
    gitDiff(input.root),
  );
  ipcMain.handle("workspace:git-diff-between", (_event, input: GitDiffInput) =>
    gitDiffBetween(input),
  );
  ipcMain.handle(
    "workspace:list-git-directory",
    (_event, input: GitDirectoryInput) => listGitDirectory(input),
  );
  ipcMain.handle("workspace:read-git-file", (_event, input: GitFileInput) =>
    readGitFile(input),
  );
  ipcMain.handle(
    "workspace:git-repository-fingerprint",
    (_event, input: { root: string }) => gitRepositoryFingerprint(input.root),
  );
  ipcMain.handle(
    "workspace:ensure-git-repository",
    (_event, input: { root: string }) => ensureWorkspaceGitRepository(input.root),
  );
  ipcMain.handle(
    "workspace:create-project",
    (_event, input: CreateProjectInput) => createProject(input),
  );
  ipcMain.handle(
    "workspace:create-worktree",
    (_event, input: CreateWorktreeInput) => createWorktree(input),
  );
  ipcMain.handle(
    "workspace:run-project-setup",
    (_event, input: RunProjectSetupInput) => runProjectSetup(input),
  );
  ipcMain.handle(
    "workspace:collect-project-initialization-diagnostics",
    (_event, input: CollectProjectInitializationDiagnosticsInput) =>
      collectProjectInitializationDiagnostics(
        input,
        setupEnvironment(resolveRuntimePath(input.worktree)),
      ),
  );
  ipcMain.handle(
    "workspace:check-host-dependencies",
    (_event, input: CheckHostDependenciesInput) =>
      checkHostDependencies({
        env: setupEnvironment(input.worktree ? resolveRuntimePath(input.worktree) : ""),
        setupScript: input.setupScript,
      }),
  );
  ipcMain.handle("workspace:get-runtime-status", () =>
    getRuntimeStatus({ env: runtimeManagerEnvironment() }),
  );
  ipcMain.handle("workspace:ensure-runtime-ready", () =>
    ensureRuntimeReady({ env: runtimeManagerEnvironment() }),
  );
  ipcMain.handle("workspace:repair-runtime", () =>
    repairRuntime({ env: runtimeManagerEnvironment() }),
  );
  ipcMain.handle("workspace:reset-runtime", () =>
    resetRuntime({ env: runtimeManagerEnvironment() }),
  );
  ipcMain.handle("workspace:uninstall-runtime", () =>
    uninstallRuntime({ env: runtimeManagerEnvironment() }),
  );
  ipcMain.handle(
    "workspace:stop-project-setup",
    (_event, input: StopProjectSetupInput) => stopProjectSetup(input),
  );
  ipcMain.handle(
    "workspace:remove-worktree",
    (_event, input: RemoveWorktreeInput) => removeWorktree(input),
  );
  ipcMain.handle(
    "workspace:resolve-project-preview-url",
    (_event, input: ResolveProjectPreviewUrlInput) =>
      resolveProjectPreviewUrl(input),
  );
  ipcMain.handle(
    "workspace:ensure-project-preview-url",
    (_event, input: ResolveProjectPreviewUrlInput) =>
      ensureProjectPreviewUrl(input),
  );
  ipcMain.handle(
    "workspace:project-runtime-healthy",
    (_event, input: ResolveProjectPreviewUrlInput) =>
      projectRuntimeHealthy(input.worktree),
  );
  ipcMain.handle(
    "workspace:list-project-services",
    (_event, input: { worktree: string }) => listProjectServices(input.worktree),
  );
  ipcMain.handle(
    "workspace:start-project-service-logs",
    (_event, input: ProjectServiceLogsInput) => startProjectServiceLogs(input),
  );
  ipcMain.handle(
    "workspace:stop-project-service-logs",
    (_event, input: { streamId: string }) =>
      stopProjectServiceLogs(input.streamId),
  );
}

async function listDirectory(input: WorkspacePathInput) {
  const directory = resolveWorkspacePath(input);
  const entries = runtimeManagedPath(directory)
    ? await readRuntimeDirectory(directory)
    : await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => ({
      name: entry.name,
      path: toWorkspacePath(input.root, joinWorkspacePath(directory, entry.name)),
      type: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) =>
      `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
    );
}

async function pathExists(path: string) {
  try {
    await stat(resolve(path));
    return true;
  } catch {
    return false;
  }
}

async function readWorkspaceFile(input: WorkspacePathInput) {
  const filePath = resolveWorkspacePath(input);
  if (runtimeManagedPath(filePath)) return readRuntimeFile(filePath);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Path is not a file");
  return readFile(filePath, "utf8");
}

async function searchFiles(input: WorkspaceSearchInput) {
  const root = resolveRuntimePath(input.root);
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.min(input.limit ?? 30, 100);
  if (runtimeManagedPath(root)) return searchRuntimeFiles(root, query, limit);
  const matches: Array<{ name: string; path: string; type: "file" }> = [];
  await walk(root, root, query, limit, matches);
  return matches;
}

async function searchRuntimeFiles(root: string, query: string, limit: number) {
  const { stdout } = await runRuntime("find", [root, "-type", "f"]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((path) => ({ name: posix.basename(path), path }))
    .filter((entry) => entry.name.toLowerCase().includes(query))
    .slice(0, limit)
    .map((entry) => ({
      name: entry.name,
      path: toWorkspacePath(root, entry.path),
      type: "file" as const,
    }));
}

async function gitDiff(root: string) {
  const cwd = resolveRuntimePath(root);
  const { stdout } = await runRuntime("git", ["diff", "--no-ext-diff", "--"], {
    cwd,
  });
  return stdout;
}

async function gitRepositoryFingerprint(root: string) {
  const cwd = resolveRuntimePath(root);
  const remoteUrls = await gitRemoteUrls(cwd);
  if (remoteUrls.length > 0) {
    return fingerprintValue(["remotes", ...remoteUrls]);
  }

  const rootCommits = await gitRootCommits(cwd);
  if (rootCommits.length > 0) {
    return fingerprintValue(["root-commits", ...rootCommits]);
  }

  return null;
}

async function createWorktree(input: CreateWorktreeInput) {
  const repositoryRoot = resolveRuntimePath(input.repositoryRoot);
  const branch = storyBranch(input.storyId, input.title);
  const worktree = worktreePath(input);

  await ensureWorkspaceGitRepository(repositoryRoot);
  await mkdirRuntime(dirnameWorkspacePath(worktree));

  if (await worktreeRegistered(repositoryRoot, worktree)) {
    await syncProjectEnvFiles(repositoryRoot, worktree);
    removedWorktrees.delete(worktree);
    return { worktree, branch };
  }

  if (await runtimePathExists(worktree)) {
    throw new Error("Worktree directory already exists but is not registered");
  }

  if (await branchExists(repositoryRoot, branch)) {
    await runRuntime("git", ["worktree", "add", worktree, branch], {
      cwd: repositoryRoot,
    });
    await syncProjectEnvFiles(repositoryRoot, worktree);
    removedWorktrees.delete(worktree);
    return { worktree, branch };
  }

  await runRuntime("git", ["worktree", "add", "-b", branch, worktree, "HEAD"], {
    cwd: repositoryRoot,
  });
  await syncProjectEnvFiles(repositoryRoot, worktree);
  removedWorktrees.delete(worktree);
  return { worktree, branch };
}

async function runProjectSetup(input: RunProjectSetupInput) {
  const worktree = resolveRuntimePath(input.worktree);
  const env = setupEnvironment(worktree);
  const setupScript = setupScriptWithoutDockerRuntimeChecks(input.setupScript);
  await assertHostDependencies({ env, setupScript });
  await assertGitRepository(worktree);
  const directory = joinWorkspacePath(worktree, ".blame", "initialization");
  const scriptPath = joinWorkspacePath(directory, "setup.sh");
  const composePath = joinWorkspacePath(directory, "docker-compose.yml");
  const logPath = setupLogPath(worktree);
  const envMounts = await envHostFileMounts(worktree);

  await mkdirRuntime(directory);
  await mkdirRuntime(dirnameWorkspacePath(logPath));
  await writeRuntimeFile(scriptPath, setupScript);
  await writeRuntimeFile(logPath, "");
  await writeRuntimeFile(
    composePath,
    await composeWithAllocatedHostPorts(
      composeWithNonMutatingNpmInstalls(
        composeWithoutNumericSuUser(
          dockerComposeWithHostFileMounts(
            dockerComposeForPreview(input.dockerCompose, worktree),
            worktree,
            envMounts,
          ),
        ),
      ),
    ),
  );
  await chmodRuntime(scriptPath, 0o755);

  const runId = randomUUID();
  const child = spawnRuntime("bash", [scriptPath], {
    cwd: worktree,
    env,
  });
  trackWorkspaceProcess(child);
  setupRuns.set(runId, { id: runId, process: child, worktree });

  child.stdout.on("data", (data: Buffer) =>
    emitSetupOutput(runId, worktree, "stdout", data.toString()),
  );
  child.stderr.on("data", (data: Buffer) =>
    emitSetupOutput(runId, worktree, "stderr", data.toString()),
  );
  child.on("exit", (code) => {
    void completeProjectSetup(runId, worktree, code);
  });

  return { runId };
}

function setupScriptWithoutDockerRuntimeChecks(script: string) {
  return script
    .replace(
      /\n?if\s+!\s+command\s+-v\s+docker\b[\s\S]*?\nfi\s*/g,
      "\n",
    )
    .replace(
      /\n?if\s+!\s+docker\s+compose\s+version\b[\s\S]*?\nfi\s*/g,
      "\n",
    )
    .replace(/^\s*command\s+-v\s+docker\b.*$/gm, "")
    .replace(/^\s*docker\s+compose\s+version\b.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

async function completeProjectSetup(
  runId: string,
  worktree: string,
  code: number | null,
) {
  if (code !== 0) {
    setupRuns.delete(runId);
    emitSetupOutput(runId, worktree, "exit", String(code ?? ""));
    return;
  }

  try {
    const existingPreviewUrl = await labeledContainerPreviewUrl(worktree);
    if (!existingPreviewUrl) await startProjectCompose(worktree);
    else await startProjectLogStream(worktree);
    setupRuns.delete(runId);
    emitSetupOutput(
      runId,
      worktree,
      "stdout",
      "Project preview containers are running.\n",
    );
    emitSetupOutput(runId, worktree, "exit", "0");
  } catch (error) {
    await stopProjectLogStream(worktree);
    setupRuns.delete(runId);
    emitSetupOutput(runId, worktree, "stderr", errorMessage(error));
    emitSetupOutput(runId, worktree, "exit", "1");
  }
}

async function startProjectCompose(worktree: string) {
  await repairProjectCompose(worktree);
  await runProjectComposeUp(worktree);
  const previewUrl = await waitForPreviewUrl(worktree);
  await waitForPreview(worktree, previewUrl);
  return previewUrl;
}

async function runProjectComposeUp(worktree: string) {
  const args = composeArgs(worktree);
  await ensureGlobalPreviewVolumes(worktree);
  await runComposeWithRetry(
    worktree,
    [...args, "pull"],
    composePullRetryDelaysMs,
    "compose image pull",
  );
  const config = await composeConfig(worktree, projectComposePath(worktree));
  const setupServices = await runSetupTaskServices(worktree, config);
  const completedServices = await runCompletedDependencyServices(
    worktree,
    config,
    setupServices,
  );
  await startProjectLogStream(worktree);
  const services = runtimeServices(
    config,
    new Set([...setupServices, ...completedServices]),
  );
  await runComposeWithRetry(
    worktree,
    [...args, "up", "-d", "--remove-orphans", ...services],
    composeUpRetryDelaysMs,
    "compose start",
  );
}

async function runSetupTaskServices(worktree: string, config: ComposeConfig) {
  const services = setupTaskServices(config);
  for (const service of services) await runProjectComposeSetupService(worktree, service);
  return new Set(services);
}

async function runCompletedDependencyServices(
  worktree: string,
  config: ComposeConfig,
  skippedServices = new Set<string>(),
) {
  const services = completedDependencyServices(config).filter(
    (service) => !skippedServices.has(service),
  );
  for (const service of services) {
    await runProjectComposeService(worktree, service);
  }
  return new Set(services);
}

async function runProjectComposeService(worktree: string, service: string) {
  const result = await containerRuntime.compose(
    [...composeArgs(worktree), "up", service],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  if (result.stdout) await appendRecoveryLog(worktree, result.stdout.trimEnd());
  if (result.stderr) await appendRecoveryLog(worktree, result.stderr.trimEnd());
}

async function runProjectComposeSetupService(worktree: string, service: string) {
  const result = await containerRuntime.compose(
    [
      ...composeArgs(worktree),
      "run",
      "--rm",
      "--no-deps",
      "--interactive=false",
      service,
    ],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  if (result.stdout) await appendRecoveryLog(worktree, result.stdout.trimEnd());
  if (result.stderr) await appendRecoveryLog(worktree, result.stderr.trimEnd());
}

function setupTaskServices(config: ComposeConfig) {
  const services = Object.entries(config.services ?? {})
    .filter(([, service]) => serviceLabels(service)["blame.setup"] === "true")
    .map(([service]) => service);
  return sortServicesByCompletedDependencies(services, config);
}

function sortServicesByCompletedDependencies(
  services: string[],
  config: ComposeConfig,
) {
  const serviceSet = new Set(services);
  const sorted: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  for (const service of services) {
    visitCompletedDependencyService(
      service,
      config,
      serviceSet,
      sorted,
      visiting,
      visited,
    );
  }
  return sorted;
}

function visitCompletedDependencyService(
  service: string,
  config: ComposeConfig,
  serviceSet: Set<string>,
  sorted: string[],
  visiting: Set<string>,
  visited: Set<string>,
) {
  if (visited.has(service) || visiting.has(service)) return;
  visiting.add(service);
  const dependencies = serviceDependsOnCompletedServices(
    config.services?.[service] ?? {},
  );
  for (const dependency of dependencies) {
    if (serviceSet.has(dependency)) {
      visitCompletedDependencyService(
        dependency,
        config,
        serviceSet,
        sorted,
        visiting,
        visited,
      );
    }
  }
  visiting.delete(service);
  visited.add(service);
  sorted.push(service);
}

function runtimeServices(config: ComposeConfig, setupServices: Set<string>) {
  return Object.keys(config.services ?? {}).filter(
    (service) => !setupServices.has(service),
  );
}

function completedDependencyServices(config: ComposeConfig) {
  return uniqueStrings(
    Object.values(config.services ?? {}).flatMap((service) =>
      serviceDependsOnCompletedServices(service),
    ),
  );
}

function serviceDependsOnCompletedServices(service: ComposeService) {
  const dependsOn = service.depends_on;
  if (!dependsOn || Array.isArray(dependsOn)) return [];
  return Object.entries(dependsOn)
    .filter(([, value]) =>
      typeof value === "object" &&
      value?.condition === "service_completed_successfully",
    )
    .map(([service]) => service);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

async function ensureGlobalPreviewVolumes(worktree: string) {
  await Promise.all(
    globalPreviewVolumes.map((volume) =>
      containerRuntime.volume(["create", volume], {
        cwd: worktree,
        env: setupEnvironment(worktree),
      }),
    ),
  );
}

function composeArgs(worktree: string) {
  return [
    "-f",
    projectComposePath(worktree),
    "--project-directory",
    worktree,
  ];
}

async function runComposeWithRetry(
  worktree: string,
  args: string[],
  retryDelays: number[],
  label: string,
) {
  let cleanupAttempted = false;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await containerRuntime.compose(args, {
        cwd: worktree,
        env: setupEnvironment(worktree),
      });
      return;
    } catch (error) {
      if (!cleanupAttempted && runtimeAddressPoolExhausted(error)) {
        cleanupAttempted = true;
        await appendRecoveryLog(
          worktree,
          "container runtime address pools exhausted, cleaning abandoned Blame previews",
        );
        const projects = await cleanupAbandonedBlamePreviews();
        await appendRecoveryLog(
          worktree,
          projects.length
            ? `cleaned abandoned previews: ${projects.join(", ")}`
            : "no abandoned previews found",
        );
        continue;
      }
      const retryDelay = retryDelays[attempt];
      if (!retryDelay || !transientRuntimePullError(error)) throw error;
      await appendRecoveryLog(
        worktree,
        `${label} interrupted, retrying in ${Math.round(retryDelay / 1_000)}s`,
      );
      await delay(retryDelay);
    }
  }
}

async function waitForPreviewUrl(worktree: string) {
  const deadline = Date.now() + previewResolveTimeoutMs;
  while (Date.now() < deadline) {
    const previewUrl = await resolveProjectPreviewUrl({ worktree });
    if (previewUrl) return previewUrl;
    await delay(previewStartupIntervalMs);
  }
  await appendComposeDiagnostics(worktree);
  throw new Error("Unable to resolve project preview URL");
}

async function stopProjectSetup(input: StopProjectSetupInput) {
  const worktree = resolveRuntimePath(input.worktree);
  const composePath = joinWorkspacePath(
    worktree,
    ".blame",
    "initialization",
    "docker-compose.yml",
  );
  if (!(await runtimePathExists(composePath))) return false;
  await repairComposeFile(composePath);
  try {
    await containerRuntime.compose(
      [
        "-f",
        composePath,
        "--project-directory",
        worktree,
        "down",
        "--remove-orphans",
      ],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    return true;
  } catch {
    return false;
  }
}

async function removeWorktree(input: RemoveWorktreeInput) {
  const repositoryRoot = resolveRuntimePath(input.repositoryRoot);
  const worktree = resolveRuntimePath(input.worktree);
  await assertGitRepository(repositoryRoot);
  const registered = await worktreeRegistered(repositoryRoot, worktree);
  if (!registered && !(await runtimePathExists(worktree))) return false;
  removingWorktrees.add(worktree);
  try {
    await stopSetupRunsForWorktree(worktree);
    await stopProjectLogStream(worktree);
    previewRecoveries.delete(worktree);
    await stopProjectSetup({ worktree });
    await removeBlamePreviewProjectResources(
      setupEnvironment(worktree).COMPOSE_PROJECT_NAME,
    );
    if (registered) await removeGitWorktree(repositoryRoot, worktree);
    else await rmRuntime(worktree);
    removedWorktrees.add(worktree);
    return true;
  } finally {
    removingWorktrees.delete(worktree);
  }
}

async function resolveProjectPreviewUrl(input: ResolveProjectPreviewUrlInput) {
  const worktree = resolveRuntimePath(input.worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (!(await isWorkspaceGitRepository(worktree))) return null;
  const composePath = projectComposePath(worktree);
  if (!(await runtimePathExists(composePath)))
    return labeledContainerPreviewUrl(worktree);
  const previewTarget = await composePreviewTarget(worktree, composePath);
  if (!previewTarget) return labeledContainerPreviewUrl(worktree);
  const address = await composePublishedAddress(
    worktree,
    composePath,
    previewTarget.service,
    previewTarget.port,
  );
  if (!address) return labeledContainerPreviewUrl(worktree);
  return previewUrl(address, previewTarget.protocol, previewTarget.path);
}

async function ensureProjectPreviewUrl(input: ResolveProjectPreviewUrlInput) {
  const worktree = resolveRuntimePath(input.worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  if (!(await isWorkspaceGitRepository(worktree))) return null;
  if (setupRunningForWorktree(worktree)) return null;
  const currentUrl = await resolveProjectPreviewUrl({ worktree });
  if (currentUrl && (await previewResponds(currentUrl))) return currentUrl;
  if (currentUrl && (await previewContainerCanStillRun(worktree))) {
    return currentUrl;
  }
  if (!(await projectSetupCompleted(worktree))) return null;
  const recovery = previewRecoveries.get(worktree);
  if (recovery) return recovery;
  const nextRecovery = recoverProjectPreview(worktree).finally(() => {
    previewRecoveries.delete(worktree);
  });
  previewRecoveries.set(worktree, nextRecovery);
  return nextRecovery;
}

function setupRunningForWorktree(worktree: string) {
  return Array.from(setupRuns.values()).some(
    (run) => run.worktree === worktree,
  );
}

async function projectSetupCompleted(worktree: string) {
  try {
    const log = await readRuntimeFile(setupLogPath(worktree));
    return (
      log.includes("Project preview containers are running.") ||
      log.includes("[setup exited with code 0]")
    );
  } catch {
    return false;
  }
}

async function recoverProjectPreview(worktree: string) {
  await runExistingProjectSetup(worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  await appendRecoveryLog(worktree, "compose starting");
  try {
    const previewUrl = await startProjectCompose(worktree);
    await appendRecoveryLog(worktree, `preview ready at ${previewUrl}`);
    return previewUrl;
  } catch (error) {
    await stopProjectLogStream(worktree);
    await appendRecoveryLog(worktree, errorMessage(error).trim());
    throw error;
  }
}

async function runExistingProjectSetup(worktree: string) {
  const scriptPath = joinWorkspacePath(worktree, ".blame", "initialization", "setup.sh");
  if (!(await runtimePathExists(scriptPath))) return;
  await appendRecoveryLog(worktree, "setup starting");
  await new Promise<void>((resolve, reject) => {
    const env = setupEnvironment(worktree);
    const child = spawnRuntime("bash", [scriptPath], {
      cwd: worktree,
      env,
    });
    trackWorkspaceProcess(child);
    child.stdout.on("data", (data: Buffer) =>
      appendRecoveryOutput(worktree, data),
    );
    child.stderr.on("data", (data: Buffer) =>
      appendRecoveryOutput(worktree, data),
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      void appendRecoveryLog(worktree, `setup exited with code ${code ?? ""}`);
      if (code === 0) resolve();
      else reject(new Error(`Project setup exited with code ${code ?? ""}`));
    });
  });
}

export async function shutdownWorkspaceProcesses() {
  const activeProcesses = Array.from(workspaceProcesses);
  setupRuns.clear();
  projectLogStreams.clear();
  projectServiceLogStreams.clear();
  workspaceProcesses.clear();
  await Promise.all(activeProcesses.map(stopChildProcess));
  await cleanupAbandonedBlamePreviews();
}

function trackWorkspaceProcess(child: ChildProcessWithoutNullStreams) {
  workspaceProcesses.add(child);
  child.once("exit", () => workspaceProcesses.delete(child));
}

async function stopChildProcess(child: ChildProcessWithoutNullStreams) {
  killChildProcess(child, "SIGTERM");
  await waitForExit(child);
}

async function stopSetupRunsForWorktree(worktree: string) {
  const runs = Array.from(setupRuns.values()).filter(
    (run) => run.worktree === worktree,
  );
  await Promise.all(
    runs.map(async (run) => {
      setupRuns.delete(run.id);
      await stopChildProcess(run.process);
    }),
  );
}

async function listProjectServices(worktreeInput: string) {
  const worktree = resolveRuntimePath(worktreeInput);
  const { stdout } = await containerRuntime.compose(
    [...composeArgs(worktree), "config", "--services"],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  return stdout
    .split("\n")
    .map((service) => service.trim())
    .filter(Boolean)
    .sort(serviceSort);
}

async function startProjectServiceLogs(input: ProjectServiceLogsInput) {
  const worktree = resolveRuntimePath(input.worktree);
  const streamId = randomUUID();
  const stream = {
    hasOutput: false,
    service: input.service,
    stopped: false,
    worktree,
  };
  projectServiceLogStreams.set(streamId, stream);
  setTimeout(() => {
    startProjectServiceLogProcess(streamId, stream);
  }, 0);
  return { streamId };
}

function startProjectServiceLogProcess(
  streamId: string,
  stream: ProjectServiceLogStream,
) {
  if (stream.stopped || projectServiceLogStreams.get(streamId) !== stream)
    return;
  const child = containerRuntime.spawnCompose(
    [
      ...composeArgs(stream.worktree),
      "logs",
      "--tail",
      "120",
      "--follow",
      stream.service,
    ],
    {
      cwd: stream.worktree,
      env: setupEnvironment(stream.worktree),
    },
  );
  stream.process = child;
  trackWorkspaceProcess(child);
  child.stdout.on("data", (data: Buffer) => {
    stream.hasOutput = true;
    emitProjectServiceLog(streamId, "stdout", data.toString());
  });
  child.stderr.on("data", (data: Buffer) => {
    stream.hasOutput = true;
    emitProjectServiceLog(streamId, "stderr", data.toString());
  });
  child.once("error", (error) => {
    emitProjectServiceLog(streamId, "stderr", errorMessage(error));
  });
  child.once("exit", (code) => {
    if (projectServiceLogStreams.get(streamId) !== stream) return;
    stream.process = undefined;
    if (stream.stopped || stream.hasOutput) {
      projectServiceLogStreams.delete(streamId);
      emitProjectServiceLog(streamId, "exit", String(code ?? ""));
      return;
    }
    stream.retry = setTimeout(() => {
      startProjectServiceLogProcess(streamId, stream);
    }, 1_000);
  });
}

async function stopProjectServiceLogs(streamId: string) {
  const stream = projectServiceLogStreams.get(streamId);
  if (!stream) return false;
  stream.stopped = true;
  if (stream.retry) clearTimeout(stream.retry);
  projectServiceLogStreams.delete(streamId);
  if (stream.process) await stopChildProcess(stream.process);
  return true;
}

function serviceSort(left: string, right: string) {
  return servicePriority(left) - servicePriority(right) || left.localeCompare(right);
}

function servicePriority(service: string) {
  if (/front|web|app/i.test(service)) return 0;
  if (/back|api|server/i.test(service)) return 1;
  if (/migrat/i.test(service)) return 2;
  if (/db|postgres|mysql|mongo|redis/i.test(service)) return 3;
  if (/install|deps|depend|init|volume/i.test(service)) return 4;
  return 5;
}

async function startProjectLogStream(worktree: string) {
  await stopProjectLogStream(worktree);
  await appendRunLogSection(worktree, "container logs");
  const stream = { stopped: false };
  projectLogStreams.set(worktree, stream);
  startProjectLogProcess(worktree, stream);
}

function startProjectLogProcess(worktree: string, stream: ProjectLogStream) {
  if (stream.stopped) return;
  const process = containerRuntime.spawnCompose(
    [
      ...composeArgs(worktree),
      "logs",
      "--tail",
      "120",
      "--follow",
    ],
    {
      cwd: worktree,
      env: setupEnvironment(worktree),
    },
  );
  stream.process = process;
  trackWorkspaceProcess(process);
  process.stdout.on("data", (data: Buffer) =>
    appendRecoveryOutput(worktree, data),
  );
  process.stderr.on("data", (data: Buffer) =>
    appendRecoveryOutput(worktree, data),
  );
  process.once("error", (error) => {
    void appendRunLogSection(worktree, errorMessage(error).trim());
  });
  process.once("exit", () => {
    if (projectLogStreams.get(worktree) !== stream) return;
    stream.process = undefined;
    if (stream.stopped) projectLogStreams.delete(worktree);
    else stream.retry = setTimeout(() => {
      startProjectLogProcess(worktree, stream);
    }, 1_000);
  });
}

async function stopProjectLogStream(worktree: string) {
  const stream = projectLogStreams.get(worktree);
  if (!stream) return;
  stream.stopped = true;
  if (stream.retry) clearTimeout(stream.retry);
  projectLogStreams.delete(worktree);
  if (stream.process) await stopChildProcess(stream.process);
}

async function appendRunLogSection(worktree: string, message: string) {
  await mkdirRuntime(dirnameWorkspacePath(setupLogPath(worktree)));
  await appendRuntimeFile(setupLogPath(worktree), `\n[${message}]\n`);
}

function waitForExit(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve();

  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      killChildProcess(child, "SIGKILL");
      resolve();
    }, forceKillDelayMs);

    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function killChildProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals,
) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== "win32" && child.pid) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }
  child.kill(signal);
}

function appendRecoveryOutput(worktree: string, data: Buffer) {
  void appendRuntimeFile(setupLogPath(worktree), data.toString());
}

async function appendRecoveryLog(worktree: string, message: string) {
  await mkdirRuntime(dirnameWorkspacePath(setupLogPath(worktree)));
  await appendRuntimeFile(setupLogPath(worktree), `\n[recovery ${message}]\n`);
}

async function walk(
  root: string,
  directory: string,
  query: string,
  limit: number,
  matches: Array<{ name: string; path: string; type: "file" }>,
) {
  if (matches.length >= limit) return;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (matches.length >= limit || shouldSkip(entry.name)) continue;
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, entryPath, query, limit, matches);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().includes(query)) {
      matches.push({
        name: entry.name,
        path: toWorkspacePath(root, entryPath),
        type: "file",
      });
    }
  }
}

function resolveWorkspacePath(input: WorkspacePathInput) {
  const root = resolveRuntimePath(input.root);
  const target = joinWorkspacePath(root, input.path ?? ".");
  const separator = root.includes("/") ? "/" : sep;
  if (target !== root && !target.startsWith(`${root}${separator}`))
    throw new Error("Path escapes workspace");
  return target;
}

function toWorkspacePath(root: string, target: string) {
  const resolvedRoot = resolveRuntimePath(root);
  const path = resolvedRoot.includes("/")
    ? posix.relative(resolvedRoot, target.replace(/\\/g, "/"))
    : relative(resolve(root), target);
  return path || ".";
}

function shouldSkip(name: string) {
  return [".git", "node_modules", "dist", "build", ".turbo"].includes(name);
}

async function gitRemoteUrls(cwd: string) {
  try {
    const { stdout } = await runRuntime(
      "git",
      ["config", "--get-regexp", "^remote\\..*\\.url$"],
      { cwd },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/, 2)[1])
      .filter(Boolean)
      .map(normalizeGitRemoteUrl)
      .sort();
  } catch {
    return [];
  }
}

async function assertGitRepository(cwd: string) {
  await runRuntime("git", ["rev-parse", "--show-toplevel"], { cwd });
}

async function ensureWorkspaceGitRepository(root: string) {
  if (!runtimeManagedPath(root)) return ensureGitRepository(root);
  if (await isWorkspaceGitRepository(root)) return false;
  await runRuntime("git", ["init"], { cwd: root });
  return true;
}

async function isWorkspaceGitRepository(root: string) {
  if (!runtimeManagedPath(root)) return isGitRepository(root);
  try {
    await assertGitRepository(root);
    return true;
  } catch {
    return false;
  }
}

async function removeGitWorktree(repositoryRoot: string, worktree: string) {
  try {
    await runRuntime("git", ["worktree", "remove", "--force", worktree], {
      cwd: repositoryRoot,
    });
  } catch (error) {
    if (!isDirectoryNotEmptyError(error)) throw error;
    if (await worktreeRegistered(repositoryRoot, worktree)) throw error;
  }

  await rmRuntime(worktree);
}

function isDirectoryNotEmptyError(error: unknown) {
  return commandText(error, "stderr").includes("Directory not empty");
}

function transientRuntimePullError(error: unknown) {
  return /failed to copy|httpReadSeeker|unexpected EOF|\bEOF\b|TLS handshake timeout|connection reset|i\/o timeout|context deadline exceeded|cloudfront\.docker\.com/i.test(
    commandErrorText(error),
  );
}

function commandErrorText(error: unknown) {
  return [errorMessageText(error), commandText(error, "stdout"), commandText(error, "stderr")].join("\n");
}

function errorMessageText(error: unknown) {
  return error instanceof Error ? error.message : "";
}

function commandText(error: unknown, key: "stdout" | "stderr") {
  if (!error || typeof error !== "object") return "";
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

async function branchExists(cwd: string, branch: string) {
  try {
    await runRuntime(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd },
    );
    return true;
  } catch {
    return false;
  }
}

async function worktreeRegistered(cwd: string, worktree: string) {
  const { stdout } = await runRuntime("git", ["worktree", "list", "--porcelain"], {
    cwd,
  });
  return stdout
    .split("\n")
    .some((line) => worktreeLineMatches(line, worktree));
}

function worktreeLineMatches(line: string, worktree: string) {
  if (!line.startsWith("worktree ")) return false;
  return normalizedPath(line.slice("worktree ".length).trim()) === normalizedPath(worktree);
}

function normalizedPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function setupEnvironment(worktree: string) {
  return {
    ...containerRuntimeEnvironment(process.env),
    ...worktreeRuntimeEnvironment(worktree),
    ...process.env,
    BLAME_HOST_GID: hostGroupId(),
    BLAME_HOST_UID: hostUserId(),
    CI: "true",
    BLAME_DOCKER_COMPOSE_FILE: projectComposePath(worktree),
    BLAME_INITIALIZATION_DIR: joinWorkspacePath(worktree, ".blame", "initialization"),
    BLAME_PROJECT_ROOT: worktree,
    BLAME_WORKTREE_ROOT: worktree,
    COMPOSE_PROJECT_NAME: `blame_${createHash("sha1")
      .update(worktree)
      .digest("hex")
      .slice(0, 12)}`,
    npm_config_yes: "true",
    PATH: setupPath(),
  };
}

function runtimeManagerEnvironment() {
  return {
    ...process.env,
    PATH: setupPath(),
  };
}

function worktreeRuntimeEnvironment(worktree: string) {
  if (!worktree) return {};
  const environment: Record<string, string> = {};
  for (const path of worktreeRuntimeEnvFiles(worktree)) {
    Object.assign(environment, runtimeEnvValues(path));
  }
  return environment;
}

function worktreeRuntimeEnvFiles(root: string) {
  const files: string[] = [];
  collectRuntimeEnvFiles(root, files);
  return files;
}

function collectRuntimeEnvFiles(directory: string, files: string[]) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredRuntimeEnvDirectory(entry.name))
        collectRuntimeEnvFiles(path, files);
      continue;
    }
    if (entry.isFile() && runtimeEnvFile(entry.name)) files.push(path);
  }
}

function runtimeEnvValues(path: string) {
  const values: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match && match[2].trim()) values[match[1]] = match[2];
  }
  return values;
}

function ignoredRuntimeEnvDirectory(name: string) {
  return [
    ".git",
    ".blame",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
  ].includes(name);
}

function runtimeEnvFile(name: string) {
  if (name !== ".env" && !name.startsWith(".env.")) return false;
  return ![".example", ".sample", ".template"].some((suffix) =>
    name.endsWith(suffix),
  );
}

function hostUserId() {
  return typeof process.getuid === "function"
    ? String(process.getuid())
    : "1000";
}

function hostGroupId() {
  return typeof process.getgid === "function"
    ? String(process.getgid())
    : "1000";
}

function projectComposePath(worktree: string) {
  return joinWorkspacePath(worktree, ".blame", "initialization", "docker-compose.yml");
}

function setupLogPath(worktree: string) {
  return joinWorkspacePath(worktree, ".blame", "logs", "setup.log");
}

async function composePreviewTarget(worktree: string, composePath: string) {
  const config = await composeConfig(worktree, composePath);
  const services = Object.entries(config.services ?? {});
  const labeledTarget = services
    .map(([service, config]) => labeledPreviewTarget(service, config))
    .find(Boolean);
  if (labeledTarget) return labeledTarget;
  return services
    .map(([service, config]) => exposedPreviewTarget(service, config))
    .find(Boolean);
}

async function composeConfig(
  worktree: string,
  composePath: string,
): Promise<ComposeConfig> {
  await repairComposeFile(composePath);
  const { stdout } = await containerRuntime.compose(
    [
      "-f",
      composePath,
      "--project-directory",
      worktree,
      "config",
    ],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  const parsed = parseYaml(stdout) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as ComposeConfig;
}

function labeledPreviewTarget(service: string, config: ComposeService) {
  const labels = serviceLabels(config);
  if (labels["blame.preview"] !== "true") return undefined;
  const port = numberValue(labels["blame.preview.port"]);
  if (!port) return undefined;
  return {
    service,
    port,
    protocol: labels["blame.preview.protocol"] || "http",
    path: labels["blame.preview.path"] || "/",
  };
}

function exposedPreviewTarget(service: string, config: ComposeService) {
  const port = config.ports?.find((port) => numberValue(port.target));
  const target = numberValue(port?.target);
  if (!target) return undefined;
  return {
    service,
    port: target,
    protocol: "http",
    path: "/",
  };
}

function serviceLabels(config: ComposeService) {
  if (!config.labels) return {};
  if (!Array.isArray(config.labels)) return config.labels;
  return Object.fromEntries(
    config.labels
      .map((label) => label.split("=", 2))
      .filter(([key]) => Boolean(key))
      .map(([key, value]) => [key, value ?? "true"]),
  );
}

async function composePublishedAddress(
  worktree: string,
  composePath: string,
  service: string,
  port: number,
) {
  try {
    await repairComposeFile(composePath);
    const { stdout } = await containerRuntime.compose(
      [
        "-f",
        composePath,
        "--project-directory",
        worktree,
        "port",
        service,
        String(port),
      ],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    return stdout.trim().split("\n").find(Boolean);
  } catch {
    return undefined;
  }
}

async function repairProjectCompose(worktree: string) {
  await repairComposeFile(projectComposePath(worktree));
}

async function repairComposeFile(composePath: string) {
  if (!(await runtimePathExists(composePath))) return;
  const compose = await readRuntimeFile(composePath);
  const repairedCompose = await composeWithAllocatedHostPorts(
    composeWithNonMutatingNpmInstalls(
      composeWithoutNumericSuUser(dockerComposeWithPortableWindowsPaths(compose)),
    ),
  );
  if (repairedCompose !== compose) await writeRuntimeFile(composePath, repairedCompose);
}

async function appendComposeDiagnostics(worktree: string) {
  await appendRecoveryLog(worktree, "compose diagnostics");
  await appendComposeOutput(worktree, ["ps", "-a"]);
  const target = await composePreviewTarget(worktree, projectComposePath(worktree));
  await appendComposeOutput(
    worktree,
    target
      ? ["logs", "--tail", "120", target.service]
      : ["logs", "--tail", "120"],
  );
}

async function appendComposeOutput(worktree: string, args: string[]) {
  try {
    const { stdout, stderr } = await containerRuntime.compose(
      [...composeArgs(worktree), ...args],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    if (stdout) await appendRecoveryLog(worktree, stdout.trimEnd());
    if (stderr) await appendRecoveryLog(worktree, stderr.trimEnd());
  } catch (error) {
    await appendRecoveryLog(worktree, commandErrorText(error).trim());
  }
}

async function labeledContainerPreviewUrl(worktree: string) {
  const containers = await previewContainers(false, worktree);
  const container = containers.find((container) =>
    containerMatchesWorktree(container, worktree),
  );
  if (!container) return null;
  const labels = container.Config?.Labels ?? {};
  const port = labels["blame.preview.port"];
  if (!port) return null;
  const binding = container.NetworkSettings?.Ports?.[`${port}/tcp`]?.[0];
  if (!binding?.HostPort) return null;
  const host = binding.HostIp || "127.0.0.1";
  return previewUrl(
    `${host}:${binding.HostPort}`,
    labels["blame.preview.protocol"] || "http",
    labels["blame.preview.path"] || "/",
  );
}

async function previewContainers(includeStopped: boolean, worktree: string) {
  try {
    const { stdout } = await containerRuntime.container(
      [
        "ps",
        ...(includeStopped ? ["-a"] : []),
        "--filter",
        "label=blame.preview=true",
        "--format",
        "{{.ID}}",
      ],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    const ids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (ids.length === 0) return [];
    return containerRuntime.inspect<RuntimeContainer>(ids);
  } catch {
    return [];
  }
}

function containerMatchesWorktree(
  container: RuntimeContainer,
  worktree: string,
) {
  const labels = container.Config?.Labels ?? {};
  const workingDir = labels["com.docker.compose.project.working_dir"];
  const configFiles = labels["com.docker.compose.project.config_files"];
  return (
    workingDir === worktree ||
    Boolean(
      configFiles
        ?.split(",")
        .some((file) => resolve(file).startsWith(`${worktree}${sep}`)),
    )
  );
}

async function waitForPreview(worktree: string, url: string) {
  for (;;) {
    if (await previewResponds(url)) return;
    await assertPreviewContainerCanStillStart(worktree);
    await delay(previewStartupIntervalMs);
  }
}

async function assertPreviewContainerCanStillStart(worktree: string) {
  const container = await previewContainerForWorktree(worktree);
  if (!container) {
    await appendComposeDiagnostics(worktree);
    throw new Error("Preview container is not running");
  }
  const status = container.State?.Status;
  const health = container.State?.Health?.Status;
  if (health === "unhealthy" || failedContainerStatus(status)) {
    await appendComposeDiagnostics(worktree);
    throw new Error(`Preview container stopped before responding (${health || status})`);
  }
}

async function previewContainerCanStillRun(worktree: string) {
  const container = await previewContainerForWorktree(worktree);
  if (!container) return false;
  const status = container.State?.Status;
  const health = container.State?.Health?.Status;
  return health !== "unhealthy" && !failedContainerStatus(status);
}

async function projectRuntimeHealthy(worktreeInput: string) {
  const worktree = resolveRuntimePath(worktreeInput);
  const composePath = projectComposePath(worktree);
  if (!(await runtimePathExists(composePath))) return false;
  const containers = await composeProjectContainers(worktree);
  const runtimeContainers = containers.filter(
    (container) => !completedSetupContainer(container),
  );
  if (runtimeContainers.length === 0) return false;
  return runtimeContainers.every(containerCanStillRun);
}

async function composeProjectContainers(worktree: string) {
  try {
    const { stdout } = await containerRuntime.compose(
      [...composeArgs(worktree), "ps", "-a", "--format", "json"],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    const ids = composePsContainerIds(stdout);
    if (ids.length === 0) return [];
    return containerRuntime.inspect<RuntimeContainer>(ids);
  } catch {
    return [];
  }
}

function composePsContainerIds(stdout: string) {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("[")) return composePsEntriesContainerIds(trimmed);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(composePsEntryContainerId);
}

function composePsEntriesContainerIds(stdout: string) {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) =>
      composePsContainerId(entry as Record<string, unknown>),
    );
  } catch {
    return [];
  }
}

function composePsEntryContainerId(line: string) {
  try {
    return composePsContainerId(JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function composePsContainerId(parsed: Record<string, unknown>) {
  const id = parsed.ID ?? parsed.Id ?? parsed.ContainerID;
  return typeof id === "string" && id ? [id] : [];
}

function completedSetupContainer(container: RuntimeContainer) {
  const labels = container.Config?.Labels ?? {};
  return (
    container.State?.Status === "exited" &&
    container.State.ExitCode === 0 &&
    labels["blame.preview"] !== "true"
  );
}

function containerCanStillRun(container: RuntimeContainer) {
  const status = container.State?.Status;
  const health = container.State?.Health?.Status;
  return health !== "unhealthy" && !failedContainerStatus(status);
}

async function previewContainerForWorktree(worktree: string) {
  const containers = await previewContainers(true, worktree);
  return containers.find((container) => containerMatchesWorktree(container, worktree));
}

function failedContainerStatus(status: string | undefined) {
  return status === "dead" || status === "exited" || status === "removing";
}

async function previewResponds(url: string) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewUrl(address: string, protocol: string, path: string) {
  const normalizedAddress = address
    .replace(/^0\.0\.0\.0:/, "127.0.0.1:")
    .replace(/^\[::\]:/, "127.0.0.1:");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${normalizedAddress}${normalizedPath}`;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? `${error.message}\n`
    : "Project setup failed.\n";
}

function emitSetupEvent(
  runId: string,
  type: "stdout" | "stderr" | "exit",
  data: string,
) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(`workspace:setup:event:${runId}`, {
      runId,
      type,
      data,
    });
  });
}

function emitSetupOutput(
  runId: string,
  worktree: string,
  type: "stdout" | "stderr" | "exit",
  data: string,
) {
  void appendRuntimeFile(setupLogPath(worktree), setupLogText(type, data));
  emitSetupEvent(runId, type, data);
}

function emitProjectServiceLog(
  streamId: string,
  type: "stdout" | "stderr" | "exit",
  data: string,
) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(`workspace:project-service-log:${streamId}`, {
      streamId,
      type,
      data,
    });
  });
}

function setupLogText(type: "stdout" | "stderr" | "exit", data: string) {
  if (type !== "exit") return data;
  return `\n[setup exited with code ${data}]\n`;
}

async function gitRootCommits(cwd: string) {
  try {
    const { stdout } = await runRuntime("git", ["rev-list", "--max-parents=0", "HEAD"], {
      cwd,
    });
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function normalizeGitRemoteUrl(value: string) {
  const trimmed = value.trim().replace(/\.git$/, "");
  const sshMatch = trimmed.match(/^([^@]+@[^:]+):(.+)$/);
  if (sshMatch) {
    return `ssh://${sshMatch[1]}/${sshMatch[2]}`.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function fingerprintValue(parts: string[]) {
  return `git:${createHash("sha256").update(parts.join("\n")).digest("hex")}`;
}
