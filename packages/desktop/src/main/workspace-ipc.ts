import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { parse as parseYaml } from "yaml";
import { generateNewProjectWithAgent } from "./agent-ipc";
import { pLimit } from "./concurrency.ts";
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
  composeWithRuntimePortPlaceholders,
  composeWithoutNumericSuUser,
  composeWithAllocatedHostPorts,
  dependencyVolumeHash,
  dockerComposeWithHostFileMounts,
  dockerComposeForPreview,
  dockerComposeWithPortableWindowsPaths,
} from "./workspace-compose";
import {
  cleanupAbandonedBlamePreviews,
  removeBlamePreviewProjectResources,
  runtimeAddressPoolExhausted,
} from "./workspace-docker-cleanup";
import {
  envHostFileMounts,
  materializedPreviewEnvFilesMatch,
  materializedPreviewEnvHostFileMounts,
  syncProjectEnvFiles,
} from "./workspace-env";
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
  hasMissingWorkspaceNodeModules,
  joinWorkspacePath,
  mkdir as mkdirRuntime,
  pathExists as runtimePathExists,
  readExistingFiles as readExistingRuntimeFiles,
  readDirectory as readRuntimeDirectory,
  readFile as readRuntimeFile,
  runtimeAccessiblePath,
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
const composeUpRetryDelaysMs = [2_000, 5_000, 10_000, 15_000];
const setupEnvironmentCacheTtlMs = 2_000;
const composeCallPromises = new Map<string, Promise<unknown>>();
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
  hostDependenciesChecked?: boolean;
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
  command?: string | string[];
  depends_on?: Record<string, { condition?: string } | string> | string[];
  image?: string;
  labels?: Record<string, string> | string[];
  ports?: Array<{
    mode?: string;
    protocol?: string;
    published?: string | number;
    target?: string | number;
  }>;
  volumes?: Array<
    | string
    | {
        source?: string;
        target?: string;
        type?: string;
      }
  >;
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
};

type RuntimeContainer = {
  Config?: {
    Env?: string[];
    Labels?: Record<string, string>;
  };
  Id?: string;
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
  startedAt: number;
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

type SetupEnvironment = NodeJS.ProcessEnv & {
  COMPOSE_PROJECT_NAME: string;
};

const setupRuns = new Map<string, SetupRun>();
const projectLogStreams = new Map<string, ProjectLogStream>();
const projectServiceLogStreams = new Map<string, ProjectServiceLogStream>();
const previewRecoveries = new Map<string, Promise<string | null>>();
const setupEnvironmentCache = new Map<
  string,
  { env?: SetupEnvironment; promise?: Promise<SetupEnvironment>; ts: number }
>();
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
    (_event, input: { root: string }) =>
      ensureWorkspaceGitRepository(input.root),
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
    async (_event, input: CollectProjectInitializationDiagnosticsInput) =>
      collectProjectInitializationDiagnostics(
        input,
        await setupEnvironment(resolveRuntimePath(input.worktree)),
      ),
  );
  ipcMain.handle(
    "workspace:check-host-dependencies",
    async (_event, input: CheckHostDependenciesInput) =>
      checkHostDependencies({
        env: await setupEnvironment(
          input.worktree ? resolveRuntimePath(input.worktree) : "",
        ),
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
    (_event, input: { worktree: string }) =>
      listProjectServices(input.worktree),
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
      path: toWorkspacePath(
        input.root,
        joinWorkspacePath(directory, entry.name),
      ),
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
  const { stdout } = await runRuntimeGit(cwd, ["diff", "--no-ext-diff", "--"]);
  return stdout;
}

async function gitRepositoryFingerprint(root: string) {
  const cwd = resolveRuntimePath(root);
  await ensureRuntimeGitSafeDirectory(cwd);
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
  const timings: Array<{ duration: number; label: string }> = [];
  const startedAt = Date.now();
  let created = false;

  await timedWorktreeCreateStep(timings, "git safe directory", () =>
    ensureRuntimeGitSafeDirectory(repositoryRoot),
  );
  await timedWorktreeCreateStep(timings, "git repository ensure", () =>
    ensureWorkspaceGitRepository(repositoryRoot),
  );
  await timedWorktreeCreateStep(timings, "worktree parent mkdir", () =>
    mkdirRuntime(dirnameWorkspacePath(worktree)),
  );

  if (
    await timedWorktreeCreateStep(timings, "worktree registered check", () =>
      worktreeRegistered(repositoryRoot, worktree),
    )
  ) {
    await timedWorktreeCreateStep(timings, "env sync", () =>
      syncProjectEnvFiles(repositoryRoot, worktree),
    );
    invalidateSetupEnvironment(worktree);
    removedWorktrees.delete(worktree);
    await appendWorktreeCreateTimings(worktree, timings, startedAt);
    return { worktree, branch };
  }

  if (
    await timedWorktreeCreateStep(timings, "worktree path exists check", () =>
      runtimePathExists(worktree),
    )
  ) {
    throw new Error("Worktree directory already exists but is not registered");
  }

  if (
    await timedWorktreeCreateStep(timings, "branch exists check", () =>
      branchExists(repositoryRoot, branch),
    )
  ) {
    await timedWorktreeCreateStep(
      timings,
      "git worktree add existing branch",
      () =>
        runRuntimeGit(repositoryRoot, ["worktree", "add", worktree, branch]),
    );
    created = true;
    await timedWorktreeCreateStep(timings, "env sync", () =>
      syncProjectEnvFiles(repositoryRoot, worktree),
    );
    invalidateSetupEnvironment(worktree);
    removedWorktrees.delete(worktree);
    await appendWorktreeCreateTimings(worktree, timings, startedAt);
    return { worktree, branch };
  }

  await timedWorktreeCreateStep(timings, "git worktree add new branch", () =>
    runRuntimeGit(repositoryRoot, [
      "worktree",
      "add",
      "-b",
      branch,
      worktree,
      "HEAD",
    ]),
  );
  created = true;
  await timedWorktreeCreateStep(timings, "env sync", () =>
    syncProjectEnvFiles(repositoryRoot, worktree),
  );
  invalidateSetupEnvironment(worktree);
  removedWorktrees.delete(worktree);
  if (created) await appendWorktreeCreateTimings(worktree, timings, startedAt);
  return { worktree, branch };
}

async function timedWorktreeCreateStep<T>(
  timings: Array<{ duration: number; label: string }>,
  label: string,
  action: () => Promise<T> | T,
) {
  const start = Date.now();
  try {
    return await action();
  } finally {
    timings.push({ duration: Date.now() - start, label });
  }
}

async function appendWorktreeCreateTimings(
  worktree: string,
  timings: Array<{ duration: number; label: string }>,
  startedAt: number,
) {
  for (const timing of timings)
    await appendTimingLog(
      worktree,
      `create worktree ${timing.label}`,
      timing.duration,
    );
  await appendTimingLog(
    worktree,
    "create worktree total",
    Date.now() - startedAt,
  );
}

async function runProjectSetup(input: RunProjectSetupInput) {
  const worktree = resolveRuntimePath(input.worktree);
  const env = await setupEnvironment(worktree);
  const setupScript = setupScriptWithoutDockerRuntimeChecks(input.setupScript);
  if (!input.hostDependenciesChecked) {
    await timedRecoveryStep(worktree, "host dependencies", () =>
      assertHostDependencies({ env, setupScript }),
    );
  }
  await timedRecoveryStep(worktree, "git repository check", () =>
    assertGitRepository(worktree),
  );
  const directory = joinWorkspacePath(worktree, ".blame", "initialization");
  const scriptPath = joinWorkspacePath(directory, "setup.sh");
  const composePath = joinWorkspacePath(directory, "docker-compose.yml");
  const logPath = setupLogPath(worktree);
  await mkdirRuntime(dirnameWorkspacePath(logPath));
  await writeRuntimeFile(logPath, "");
  const symlinkEnvMounts = await timedRecoveryStep(
    worktree,
    "env file scan",
    () => envHostFileMounts(worktree),
  );

  await timedRecoveryStep(worktree, "initialization files", async () => {
    await timedRecoveryStep(worktree, "initialization directory mkdir", () =>
      mkdirRuntime(directory),
    );
    await timedRecoveryStep(worktree, "setup script write", () =>
      writeRuntimeFile(scriptPath, setupScript),
    );
    const compose = await timedRecoveryStep(worktree, "compose prepare", () =>
      prepareProjectCompose(worktree, input.dockerCompose, symlinkEnvMounts),
    );
    await timedRecoveryStep(worktree, "compose file write", () =>
      writeRuntimeFile(composePath, compose),
    );
    await timedRecoveryStep(worktree, "setup script chmod", () =>
      chmodRuntime(scriptPath, 0o755),
    );
  });

  return timedRecoveryStep(worktree, "setup process spawn", () =>
    startProjectSetupProcess(worktree, scriptPath, env),
  );
}

function startProjectSetupProcess(
  worktree: string,
  scriptPath: string,
  env: NodeJS.ProcessEnv,
) {
  const runId = randomUUID();
  const child = spawnRuntime("bash", [scriptPath], {
    cwd: worktree,
    env,
  });
  trackWorkspaceProcess(child);
  setupRuns.set(runId, {
    id: runId,
    process: child,
    startedAt: Date.now(),
    worktree,
  });

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
    .replace(/\n?if\s+!\s+command\s+-v\s+docker\b[\s\S]*?\nfi\s*/g, "\n")
    .replace(/\n?if\s+!\s+docker\s+compose\s+version\b[\s\S]*?\nfi\s*/g, "\n")
    .replace(/^\s*command\s+-v\s+docker\b.*$/gm, "")
    .replace(/^\s*docker\s+compose\s+version\b.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
}

async function completeProjectSetup(
  runId: string,
  worktree: string,
  code: number | null,
) {
  const run = setupRuns.get(runId);
  if (run) {
    await appendTimingLog(
      worktree,
      "setup process runtime",
      Date.now() - run.startedAt,
    );
  }
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

async function startProjectCompose(
  worktree: string,
  options: { reallocatePorts?: boolean } = {},
) {
  await timedRecoveryStep(worktree, "compose repair", () =>
    repairProjectCompose(worktree, options),
  );
  await timedRecoveryStep(worktree, "compose up", () =>
    runProjectComposeUp(worktree),
  );
  const previewUrl = await timedRecoveryStep(
    worktree,
    "preview url resolve",
    () => waitForPreviewUrl(worktree),
  );
  if (
    await timedRecoveryStep(worktree, "preview environment sync", () =>
      syncPreviewRuntimeEnvironment(worktree, previewUrl),
    )
  ) {
    await timedRecoveryStep(worktree, "preview service restart", () =>
      restartPreviewService(worktree, true),
    );
  }
  await timedRecoveryStep(worktree, "preview response wait", () =>
    waitForPreview(worktree, previewUrl),
  );
  return previewUrl;
}

async function syncPreviewRuntimeEnvironment(
  worktree: string,
  previewUrl: string,
) {
  const origin = previewOrigin(previewUrl);
  if (!origin) return false;
  if (await materializedPreviewEnvFilesMatch(worktree, origin)) return false;
  await materializedPreviewEnvHostFileMounts(worktree, origin);
  invalidateSetupEnvironment(worktree);
  return true;
}

async function clearPreviewBuildCache(worktree: string) {
  await rmRuntime(joinWorkspacePath(worktree, ".next"));
}

async function restartPreviewService(
  worktree: string,
  clearBuildCache = false,
) {
  const container = await previewContainerForWorktree(worktree);
  if (!container?.Id) return;
  const env = await setupEnvironment(worktree);
  await containerRuntime.container(["stop", container.Id], {
    cwd: worktree,
    env,
  });
  if (clearBuildCache) await clearPreviewBuildCache(worktree);
  await containerRuntime.container(["start", container.Id], {
    cwd: worktree,
    env,
  });
}

async function runProjectComposeUp(worktree: string) {
  const args = composeArgs(worktree);
  await timedRecoveryStep(worktree, "compose volumes", () =>
    ensureGlobalPreviewVolumes(worktree),
  );
  const config = await timedRecoveryStep(worktree, "compose config", () =>
    composeConfig(worktree, projectComposePath(worktree)),
  );
  const setupServices = await timedRecoveryStep(
    worktree,
    "compose setup services",
    () => runSetupTaskServices(worktree, config),
  );
  const completedServices = await timedRecoveryStep(
    worktree,
    "compose completed dependencies",
    () => runCompletedDependencyServices(worktree, config, setupServices),
  );
  await timedRecoveryStep(worktree, "compose log stream", () =>
    startProjectLogStream(worktree),
  );
  const services = runtimeServices(
    config,
    new Set([...setupServices, ...completedServices]),
  );
  await timedRecoveryStep(worktree, "compose runtime services", () =>
    runComposeWithRetry(
      worktree,
      [
        ...args,
        "up",
        "-d",
        "--pull",
        "missing",
        "--force-recreate",
        "--remove-orphans",
        ...services,
      ],
      composeUpRetryDelaysMs,
      "compose start",
    ),
  );
}

async function runSetupTaskServices(worktree: string, config: ComposeConfig) {
  const services = setupTaskServices(config);
  for (const service of services) {
    const serviceConfig = config.services?.[service];
    if (
      serviceConfig &&
      (await timedRecoveryStep(
        worktree,
        `dependency cache check ${service}`,
        () => dependencyCacheReady(worktree, serviceConfig),
      ))
    ) {
      await appendRecoveryLog(worktree, `dependency cache hit: ${service}`);
      continue;
    }
    await timedRecoveryStep(worktree, `compose setup service ${service}`, () =>
      runProjectComposeSetupService(worktree, service),
    );
    if (serviceConfig)
      await timedRecoveryStep(
        worktree,
        `dependency cache mark ${service}`,
        () => markDependencyCacheReady(worktree, serviceConfig),
      );
  }
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
    if (
      skippableDependencyInitService(service) &&
      (await timedRecoveryStep(
        worktree,
        `dependency init cache check ${service}`,
        () => setupDependencyCachesReady(worktree, config),
      ))
    ) {
      await appendRecoveryLog(
        worktree,
        `dependency init cache hit: ${service}`,
      );
      continue;
    }
    await timedRecoveryStep(
      worktree,
      `compose dependency service ${service}`,
      () => runProjectComposeService(worktree, service),
    );
  }
  return new Set(services);
}

function skippableDependencyInitService(service: string) {
  return (
    service === "blame-dependencies-init" || service === "blame-volumes-init"
  );
}

async function setupDependencyCachesReady(
  worktree: string,
  config: ComposeConfig,
) {
  const services = setupTaskServices(config)
    .map((service) => config.services?.[service])
    .filter((service): service is ComposeService => Boolean(service));
  if (services.length === 0) return false;
  for (const service of services) {
    if (!(await dependencyCacheReady(worktree, service))) return false;
  }
  return true;
}

async function dependencyCacheReady(worktree: string, service: ComposeService) {
  const cache = dependencyCache(service);
  if (!cache) return false;
  if (await hasMissingWorkspaceNodeModules(worktree)) {
    return false;
  }
  const env = await setupEnvironment(worktree);
  for (const volume of cache.volumes) {
    try {
      await containerRuntime.container(
        [
          "run",
          "--rm",
          "--pull=never",
          "-v",
          `${volume}:/node_modules`,
          dependencyCacheImage(service),
          "sh",
          "-lc",
          `test -e /node_modules/${dependencyCacheMarker(cache.key)}`,
        ],
        { cwd: worktree, env },
      );
    } catch {
      return false;
    }
  }
  return true;
}

async function markDependencyCacheReady(
  worktree: string,
  service: ComposeService,
) {
  const cache = dependencyCache(service);
  if (!cache) return;
  try {
    const env = await setupEnvironment(worktree);
    for (const volume of cache.volumes) {
      await containerRuntime.container(
        [
          "run",
          "--rm",
          "--pull=never",
          "-v",
          `${volume}:/node_modules`,
          dependencyCacheImage(service),
          "sh",
          "-lc",
          `touch /node_modules/${dependencyCacheMarker(cache.key)}`,
        ],
        { cwd: worktree, env },
      );
    }
  } catch (error) {
    await appendRecoveryLog(
      worktree,
      `dependency cache marker failed: ${errorMessage(error).trim()}`,
    );
  }
}

function dependencyCache(service: ComposeService) {
  const labels = serviceLabels(service);
  if (labels["blame.dependencies.cache"] !== "true") return undefined;
  const key = labels["blame.dependencies.cache.key"];
  const volumes = nodeModulesVolumeSources(service);
  if (!key || volumes.length === 0) return undefined;
  return { key, volumes };
}

function dependencyCacheImage(service: ComposeService) {
  return service.image || "node:22-bookworm-slim";
}

function dependencyCacheMarker(key: string) {
  return `.blame-deps-${key.replace(/[^a-f0-9]/gi, "")}.ready`;
}

function nodeModulesVolumeSources(service: ComposeService) {
  return uniqueStrings(
    (service.volumes ?? []).flatMap((volume) => {
      const parsed = composeVolume(volume);
      return parsed?.target.replace(/\/$/, "").endsWith("/node_modules")
        ? [parsed.source]
        : [];
    }),
  );
}

function composeVolume(volume: NonNullable<ComposeService["volumes"]>[number]) {
  if (typeof volume !== "string") {
    if (!volume.source || !volume.target) return undefined;
    if (volume.type && volume.type !== "volume") return undefined;
    return { source: volume.source, target: volume.target };
  }
  const [source, target] = volume.split(":");
  if (!source || !target || target.startsWith("./") || target.startsWith("../"))
    return undefined;
  return { source, target };
}

async function runProjectComposeService(worktree: string, service: string) {
  const result = await containerRuntime.compose(
    [...composeArgs(worktree), "up", service],
    { cwd: worktree, env: await setupEnvironment(worktree) },
  );
  if (result.stdout) await appendRecoveryLog(worktree, result.stdout.trimEnd());
  if (result.stderr) await appendRecoveryLog(worktree, result.stderr.trimEnd());
}

async function runProjectComposeSetupService(
  worktree: string,
  service: string,
) {
  const result = await containerRuntime.compose(
    [
      ...composeArgs(worktree),
      "run",
      "--rm",
      "--no-deps",
      "--interactive=false",
      service,
    ],
    { cwd: worktree, env: await setupEnvironment(worktree) },
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
    .filter(
      ([, value]) =>
        typeof value === "object" &&
        value?.condition === "service_completed_successfully",
    )
    .map(([service]) => service);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

async function ensureGlobalPreviewVolumes(worktree: string) {
  const env = await setupEnvironment(worktree);
  await Promise.all(
    globalPreviewVolumes.map((volume) =>
      timedRecoveryStep(worktree, `compose volume create ${volume}`, () =>
        containerRuntime.volume(["create", volume], {
          cwd: worktree,
          env,
        }),
      ),
    ),
  );
}

function composeArgs(worktree: string) {
  return ["-f", projectComposePath(worktree), "--project-directory", worktree];
}

async function runComposeWithRetry(
  worktree: string,
  args: string[],
  retryDelays: number[],
  label: string,
) {
  let cleanupAttempted = false;
  for (let attempt = 0; ; attempt += 1) {
    const start = Date.now();
    try {
      await containerRuntime.compose(args, {
        cwd: worktree,
        env: await setupEnvironment(worktree),
      });
      await appendTimingLog(
        worktree,
        `${label} attempt ${attempt + 1} success`,
        Date.now() - start,
      );
      return;
    } catch (error) {
      await appendTimingLog(
        worktree,
        `${label} attempt ${attempt + 1} failed`,
        Date.now() - start,
      );
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
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    const previewUrl = await resolveProjectPreviewUrl({ worktree });
    if (previewUrl) {
      await appendRecoveryLog(
        worktree,
        `preview url resolved after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      );
      return previewUrl;
    }
    await delay(previewStartupIntervalMs);
  }
  await appendRecoveryLog(
    worktree,
    `preview url resolve timed out after ${attempts} attempts`,
  );
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
  await repairComposeFile(worktree, composePath);
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
      { cwd: worktree, env: await setupEnvironment(worktree) },
    );
    return true;
  } catch {
    return false;
  }
}

async function removeWorktree(input: RemoveWorktreeInput) {
  const repositoryRoot = resolveRuntimePath(input.repositoryRoot);
  const worktree = resolveRuntimePath(input.worktree);
  await ensureRuntimeGitSafeDirectory(repositoryRoot);
  await assertGitRepository(repositoryRoot);
  const registered = await worktreeRegistered(repositoryRoot, worktree);
  if (!registered && !(await runtimePathExists(worktree))) return false;
  removingWorktrees.add(worktree);
  try {
    await stopSetupRunsForWorktree(worktree);
    await stopProjectLogStream(worktree);
    previewRecoveries.delete(worktree);
    await stopProjectSetup({ worktree });
    const env = await setupEnvironment(worktree);
    await removeBlamePreviewProjectResources(env.COMPOSE_PROJECT_NAME);
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
  const previewTarget = await safeComposePreviewTarget(worktree, composePath);
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

async function safeComposePreviewTarget(worktree: string, composePath: string) {
  try {
    return await composePreviewTarget(worktree, composePath);
  } catch {
    return undefined;
  }
}

async function ensureProjectPreviewUrl(input: ResolveProjectPreviewUrlInput) {
  const worktree = resolveRuntimePath(input.worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  if (!(await isWorkspaceGitRepository(worktree))) return null;
  if (setupRunningForWorktree(worktree)) return null;
  const currentUrl = await resolveProjectPreviewUrl({ worktree });
  if (currentUrl && (await previewResponds(currentUrl))) {
    const currentOrigin = previewOrigin(currentUrl);
    const envMatches = await materializedPreviewEnvFilesMatch(
      worktree,
      currentOrigin,
    );
    if (envMatches) return currentUrl;
  }
  if (!(await projectSetupCompleted(worktree))) return null;
  const recovery = previewRecoveries.get(worktree);
  if (recovery) return recovery;
  const nextRecovery = recoverProjectPreview(worktree, {
    reallocatePorts: Boolean(currentUrl),
  }).finally(() => {
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

async function recoverProjectPreview(
  worktree: string,
  options: { reallocatePorts?: boolean } = {},
) {
  await runExistingProjectSetup(worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  await appendRecoveryLog(worktree, "compose starting");
  try {
    const previewUrl = await startProjectCompose(worktree, options);
    await appendRecoveryLog(worktree, `preview ready at ${previewUrl}`);
    return previewUrl;
  } catch (error) {
    await stopProjectLogStream(worktree);
    await appendRecoveryLog(worktree, errorMessage(error).trim());
    throw error;
  }
}

async function runExistingProjectSetup(worktree: string) {
  const scriptPath = joinWorkspacePath(
    worktree,
    ".blame",
    "initialization",
    "setup.sh",
  );
  if (!(await runtimePathExists(scriptPath))) return;
  await appendRecoveryLog(worktree, "setup starting");
  const env = await setupEnvironment(worktree);
  await new Promise<void>((resolve, reject) => {
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
  const composePath = projectComposePath(worktree);
  try {
    if (await runtimePathExists(composePath)) {
      return composeConfigServiceNames(await readRuntimeFile(composePath));
    }
  } catch {}
  return listProjectServicesWithCompose(worktree);
}

async function listProjectServicesWithCompose(worktree: string) {
  const { stdout } = await containerRuntime.compose(
    [...composeArgs(worktree), "config", "--services"],
    { cwd: worktree, env: await setupEnvironment(worktree) },
  );
  return serviceNamesFromText(stdout);
}

function composeConfigServiceNames(compose: string) {
  const parsed = parseYaml(compose) as unknown;
  if (!parsed || typeof parsed !== "object") return [];
  const services = (parsed as ComposeConfig).services;
  if (!services || typeof services !== "object") return [];
  return Object.keys(services).sort(serviceSort);
}

function serviceNamesFromText(stdout: string) {
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
    void startProjectServiceLogProcess(streamId, stream).catch((error) =>
      emitProjectServiceLog(streamId, "stderr", errorMessage(error)),
    );
  }, 0);
  return { streamId };
}

async function startProjectServiceLogProcess(
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
      env: await setupEnvironment(stream.worktree),
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
    void fallbackProjectServiceLog(streamId, stream, code);
  });
}

async function fallbackProjectServiceLog(
  streamId: string,
  stream: ProjectServiceLogStream,
  code: number | null,
) {
  if (await emitArchivedProjectServiceLog(streamId, stream)) {
    projectServiceLogStreams.delete(streamId);
    emitProjectServiceLog(streamId, "exit", String(code ?? ""));
    return;
  }
  stream.retry = setTimeout(() => {
    void startProjectServiceLogProcess(streamId, stream).catch((error) =>
      emitProjectServiceLog(streamId, "stderr", errorMessage(error)),
    );
  }, 1_000);
}

async function emitArchivedProjectServiceLog(
  streamId: string,
  stream: ProjectServiceLogStream,
) {
  const content = await archivedProjectServiceLog(
    stream.worktree,
    stream.service,
  );
  if (!content) return false;
  stream.hasOutput = true;
  emitProjectServiceLog(streamId, "stdout", content);
  return true;
}

async function archivedProjectServiceLog(worktree: string, service: string) {
  try {
    const log = await readRuntimeFile(setupLogPath(worktree));
    return archivedServiceLogSection(log, service);
  } catch {
    return "";
  }
}

function archivedServiceLogSection(log: string, service: string) {
  const normalized = normalizedServiceName(service);
  const lines = log
    .split("\n")
    .filter((line) => archivedServiceLogLine(line, normalized));
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function archivedServiceLogLine(line: string, service: string) {
  const normalized = normalizedServiceName(line);
  if (service === "deps")
    return (
      /\bdeps(?:-|_)?run\b/.test(normalized) ||
      /\bservice deps\b/.test(normalized)
    );
  return normalized.includes(service);
}

function normalizedServiceName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
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
  return (
    servicePriority(left) - servicePriority(right) || left.localeCompare(right)
  );
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
  await startProjectLogProcess(worktree, stream);
}

async function startProjectLogProcess(
  worktree: string,
  stream: ProjectLogStream,
) {
  if (stream.stopped) return;
  const process = containerRuntime.spawnCompose(
    [...composeArgs(worktree), "logs", "--tail", "120", "--follow"],
    {
      cwd: worktree,
      env: await setupEnvironment(worktree),
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
    else
      stream.retry = setTimeout(() => {
        void startProjectLogProcess(worktree, stream).catch((error) => {
          void appendRunLogSection(worktree, errorMessage(error).trim());
        });
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

async function timedRecoveryStep<T>(
  worktree: string,
  label: string,
  action: () => Promise<T> | T,
) {
  const start = Date.now();
  try {
    return await action();
  } finally {
    await appendTimingLog(worktree, label, Date.now() - start);
  }
}

async function appendTimingLog(
  worktree: string,
  label: string,
  duration: number,
) {
  try {
    await appendRecoveryLog(worktree, `timing ${label}: ${duration}ms`);
    await appendRuntimeFile(
      timingLogPath(worktree),
      `${JSON.stringify({
        at: new Date().toISOString(),
        durationMs: duration,
        label,
      })}\n`,
    );
  } catch {}
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
    const { stdout } = await runRuntimeGit(cwd, [
      "config",
      "--get-regexp",
      "^remote\\..*\\.url$",
    ]);
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
  await runRuntimeGit(cwd, ["rev-parse", "--show-toplevel"]);
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
  await ensureRuntimeGitSafeDirectory(repositoryRoot);
  try {
    await runRuntimeGit(repositoryRoot, [
      "worktree",
      "remove",
      "--force",
      worktree,
    ]);
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      await removeStaleGitWorktree(repositoryRoot, worktree);
      return;
    }
    if (!isDirectoryNotEmptyError(error)) throw error;
    if (await worktreeRegistered(repositoryRoot, worktree)) throw error;
  }

  await rmRuntime(worktree);
}

async function removeStaleGitWorktree(
  repositoryRoot: string,
  worktree: string,
) {
  await rmRuntime(worktree);
  await runRuntimeGit(repositoryRoot, ["worktree", "prune"]);
  if (await worktreeRegistered(repositoryRoot, worktree))
    throw new Error("Unable to unregister worktree.");
}

function isDirectoryNotEmptyError(error: unknown) {
  return commandText(error, "stderr").includes("Directory not empty");
}

function isPermissionDeniedError(error: unknown) {
  return commandErrorText(error).includes("Permission denied");
}

function transientRuntimePullError(error: unknown) {
  return /failed to copy|httpReadSeeker|unexpected EOF|\bEOF\b|TLS handshake timeout|connection reset|i\/o timeout|context deadline exceeded|cloudfront\.docker\.com/i.test(
    commandErrorText(error),
  );
}

function commandErrorText(error: unknown) {
  return [
    errorMessageText(error),
    commandText(error, "stdout"),
    commandText(error, "stderr"),
  ].join("\n");
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
    await runRuntimeGit(cwd, [
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${branch}`,
    ]);
    return true;
  } catch {
    return false;
  }
}

async function worktreeRegistered(cwd: string, worktree: string) {
  const { stdout } = await runRuntimeGit(cwd, [
    "worktree",
    "list",
    "--porcelain",
  ]);
  return stdout.split("\n").some((line) => worktreeLineMatches(line, worktree));
}

async function ensureRuntimeGitSafeDirectory(cwd: string) {
  if (process.platform !== "win32") return;
  const safeDirectory = runtimeGitSafeDirectory(cwd);
  const stdout = await configuredSafeDirectories();
  if (safeDirectoryConfigured(stdout, safeDirectory)) return;
  await addRuntimeGitSafeDirectory(cwd);
}

async function runRuntimeGit(cwd: string, args: string[]) {
  await ensureRuntimeGitSafeDirectory(cwd);
  try {
    return await runRuntime("git", args, { cwd });
  } catch (error) {
    if (!dubiousOwnershipError(error)) throw error;
    await addRuntimeGitSafeDirectory(cwd);
    return runRuntime("git", args, { cwd });
  }
}

async function addRuntimeGitSafeDirectory(cwd: string) {
  const safeDirectory = runtimeGitSafeDirectory(cwd);
  await runRuntime("git", [
    "config",
    "--global",
    "--add",
    "safe.directory",
    safeDirectory,
  ]);
}

function runtimeGitSafeDirectory(cwd: string) {
  if (process.platform === "win32") return runtimeAccessiblePath(cwd, "win32");
  return cwd;
}

function dubiousOwnershipError(error: unknown) {
  return commandErrorText(error).includes("detected dubious ownership");
}

async function configuredSafeDirectories() {
  try {
    const { stdout } = await runRuntime("git", [
      "config",
      "--global",
      "--get-all",
      "safe.directory",
    ]);
    return stdout;
  } catch {
    return "";
  }
}

function safeDirectoryConfigured(stdout: string, safeDirectory: string) {
  return stdout
    .split("\n")
    .map((line) => normalizedPath(line.trim()))
    .includes(normalizedPath(safeDirectory));
}

function worktreeLineMatches(line: string, worktree: string) {
  if (!line.startsWith("worktree ")) return false;
  return (
    normalizedPath(line.slice("worktree ".length).trim()) ===
    normalizedPath(worktree)
  );
}

function normalizedPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

async function setupEnvironment(worktree: string) {
  const cached = setupEnvironmentCache.get(worktree);
  const now = Date.now();
  if (cached?.promise) return cached.promise;
  if (cached?.env && now - cached.ts < setupEnvironmentCacheTtlMs)
    return cached.env;
  const promise = buildSetupEnvironment(worktree);
  setupEnvironmentCache.set(worktree, {
    promise,
    ts: now,
    env: cached?.env,
  });
  try {
    const env = await promise;
    setupEnvironmentCache.set(worktree, { env, ts: Date.now() });
    return env;
  } catch (error) {
    setupEnvironmentCache.delete(worktree);
    throw error;
  }
}

async function buildSetupEnvironment(
  worktree: string,
): Promise<SetupEnvironment> {
  return {
    ...containerRuntimeEnvironment(process.env),
    ...(await worktreeRuntimeEnvironment(worktree)),
    ...process.env,
    BLAME_HOST_GID: hostGroupId(),
    BLAME_HOST_UID: hostUserId(),
    CI: "true",
    BLAME_DOCKER_COMPOSE_FILE: projectComposePath(worktree),
    BLAME_INITIALIZATION_DIR: joinWorkspacePath(
      worktree,
      ".blame",
      "initialization",
    ),
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

function invalidateSetupEnvironment(worktree: string) {
  setupEnvironmentCache.delete(worktree);
}

function runtimeManagerEnvironment() {
  return {
    ...process.env,
    PATH: setupPath(),
  };
}

async function worktreeRuntimeEnvironment(worktree: string) {
  if (!worktree) return {};
  const environment: Record<string, string> = {};
  const envFiles = await worktreeRuntimeEnvFiles(worktree);
  const envValues = await Promise.all(envFiles.map(runtimeEnvValues));
  for (const values of envValues) {
    Object.assign(environment, values);
  }
  return environment;
}

async function worktreeRuntimeEnvFiles(root: string) {
  const files: string[] = [];
  await collectRuntimeEnvFiles(root, files);
  return files.sort();
}

async function collectRuntimeEnvFiles(directory: string, files: string[]) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredRuntimeEnvDirectory(entry.name)) {
          await collectRuntimeEnvFiles(path, files);
        }
        return;
      }
      if (entry.isFile() && runtimeEnvFile(entry.name)) {
        files.push(path);
      }
    }),
  );
}

async function runtimeEnvValues(path: string) {
  const values: Record<string, string> = {};
  for (const line of (await readFile(path, "utf8")).split("\n")) {
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
  return joinWorkspacePath(
    worktree,
    ".blame",
    "initialization",
    "docker-compose.yml",
  );
}

function setupLogPath(worktree: string) {
  return joinWorkspacePath(worktree, ".blame", "logs", "setup.log");
}

function timingLogPath(worktree: string) {
  return joinWorkspacePath(worktree, ".blame", "logs", "timing.jsonl");
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
  return dedupeComposeCall(`config:${worktree}:${composePath}`, () =>
    loadComposeConfig(worktree, composePath),
  );
}

async function loadComposeConfig(
  worktree: string,
  composePath: string,
): Promise<ComposeConfig> {
  const { stdout } = await containerRuntime.compose(
    ["-f", composePath, "--project-directory", worktree, "config"],
    { cwd: worktree, env: await setupEnvironment(worktree) },
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
  return dedupeComposeCall(
    `port:${worktree}:${composePath}:${service}:${port}`,
    () => loadComposePublishedAddress(worktree, composePath, service, port),
  );
}

async function loadComposePublishedAddress(
  worktree: string,
  composePath: string,
  service: string,
  port: number,
) {
  try {
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
      { cwd: worktree, env: await setupEnvironment(worktree) },
    );
    return stdout.trim().split("\n").find(Boolean);
  } catch {
    return undefined;
  }
}

function dedupeComposeCall<T>(key: string, action: () => Promise<T>) {
  const current = composeCallPromises.get(key) as Promise<T> | undefined;
  if (current) return current;
  const next = action().finally(() => composeCallPromises.delete(key));
  composeCallPromises.set(key, next);
  return next;
}

async function repairProjectCompose(
  worktree: string,
  options: { reallocatePorts?: boolean } = {},
) {
  await repairComposeFile(worktree, projectComposePath(worktree), options);
}

async function repairComposeFile(
  worktree: string,
  composePath: string,
  options: { reallocatePorts?: boolean } = {},
) {
  if (!(await runtimePathExists(composePath))) return;
  const compose = await readRuntimeFile(composePath);
  const allocatedCompose = await composeWithAllocatedHostPorts(
    composeWithNonMutatingNpmInstalls(
      composeWithoutNumericSuUser(
        composeWithRuntimePortPlaceholders(
          dockerComposeWithPortableWindowsPaths(compose),
          options.reallocatePorts,
        ),
      ),
    ),
  );
  const envMounts = await materializedPreviewEnvHostFileMounts(
    worktree,
    composePreviewOrigin(allocatedCompose),
  );
  const repairedCompose = dockerComposeWithHostFileMounts(
    allocatedCompose,
    worktree,
    envMounts,
  );
  if (repairedCompose !== compose)
    await writeRuntimeFile(composePath, repairedCompose);
}

async function prepareProjectCompose(
  worktree: string,
  compose: string,
  symlinkEnvMounts: Awaited<ReturnType<typeof envHostFileMounts>>,
) {
  const dependencyKey = await timedRecoveryStep(
    worktree,
    "dependency hash",
    () => dependencyVolumeHashForWorktree(worktree, compose),
  );
  const normalizedCompose = await timedRecoveryStep(
    worktree,
    "compose normalize",
    () =>
      composeWithNonMutatingNpmInstalls(
        composeWithoutNumericSuUser(
          dockerComposeForPreview(compose, worktree, dependencyKey),
        ),
      ),
  );
  const allocatedCompose = await timedRecoveryStep(
    worktree,
    "compose allocate ports",
    () => composeWithAllocatedHostPorts(normalizedCompose),
  );
  const envMounts = await timedRecoveryStep(
    worktree,
    "preview env host mounts",
    () =>
      materializedPreviewEnvHostFileMounts(
        worktree,
        composePreviewOrigin(allocatedCompose),
      ),
  );
  return timedRecoveryStep(worktree, "compose inject host mounts", () =>
    dockerComposeWithHostFileMounts(allocatedCompose, worktree, [
      ...symlinkEnvMounts,
      ...envMounts,
    ]),
  );
}

const dependencyHashFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

async function dependencyVolumeHashForWorktree(
  worktree: string,
  compose: string,
) {
  const hash = createHash("sha256");
  const paths = dependencyHashFiles.map((file) => ({
    file,
    path: joinWorkspacePath(worktree, file),
  }));
  const contents = await readExistingRuntimeFiles(
    paths.map(({ path }) => path),
  );
  const foundInputs = paths.flatMap(({ file, path }) => {
    const content = contents[path];
    return typeof content === "string" ? [{ content, file }] : [];
  });
  for (const { content, file } of foundInputs) {
    await appendRecoveryLog(worktree, `dependency hash input: ${file}`);
    hash.update(file);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  if (foundInputs.length === 0) return dependencyVolumeHash(compose);
  return hash.digest("hex").slice(0, 12);
}

function composePreviewOrigin(compose: string) {
  const match = /(?:127\.0\.0\.1|localhost):(\d+):\d+/.exec(compose);
  return match ? `http://localhost:${match[1]}` : undefined;
}

async function appendComposeDiagnostics(worktree: string) {
  await appendRecoveryLog(worktree, "compose diagnostics");
  await appendComposeOutput(worktree, ["ps", "-a"]);
  const target = await composePreviewTarget(
    worktree,
    projectComposePath(worktree),
  );
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
      { cwd: worktree, env: await setupEnvironment(worktree) },
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
  const url = previewUrl(
    `${host}:${binding.HostPort}`,
    labels["blame.preview.protocol"] || "http",
    labels["blame.preview.path"] || "/",
  );
  return containerPublicOriginsMatchPreview(container, url) ? url : null;
}

function containerPublicOriginsMatchPreview(
  container: RuntimeContainer,
  previewUrl: string,
) {
  const expectedOrigin = previewOrigin(previewUrl);
  if (!expectedOrigin) return true;
  for (const value of container.Config?.Env ?? []) {
    const [key, ...parts] = value.split("=");
    if (!publicOriginEnvironmentKey(key)) continue;
    const origin = previewOrigin(parts.join("="));
    if (origin && origin !== expectedOrigin) return false;
  }
  return true;
}

function publicOriginEnvironmentKey(key: string) {
  return [
    "APP_URL",
    "APPLICATION_URL",
    "BETTER_AUTH_URL",
    "CANONICAL_URL",
    "NEXT_PUBLIC_APP_URL",
    "NEXT_PUBLIC_BASE_URL",
    "NEXTAUTH_URL",
    "PUBLIC_URL",
    "SITE_URL",
  ].includes(key);
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
      { cwd: worktree, env: await setupEnvironment(worktree) },
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
  const normalizedWorktree = runtimeLabelPath(worktree);
  return (
    runtimeLabelPath(workingDir ?? "") === normalizedWorktree ||
    Boolean(
      configFiles
        ?.split(",")
        .some((file) =>
          runtimeLabelPath(file).startsWith(`${normalizedWorktree}/`),
        ),
    )
  );
}

function runtimeLabelPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

async function waitForPreview(worktree: string, url: string) {
  let attempts = 0;
  for (;;) {
    attempts += 1;
    if (await previewResponds(url)) {
      await appendRecoveryLog(
        worktree,
        `preview responded after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      );
      return;
    }
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
    throw new Error(
      `Preview container stopped before responding (${health || status})`,
    );
  }
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
  return dedupeComposeCall(`containers:${worktree}`, () =>
    loadComposeProjectContainers(worktree),
  );
}

async function loadComposeProjectContainers(worktree: string) {
  try {
    const { stdout } = await containerRuntime.compose(
      [...composeArgs(worktree), "ps", "-a", "--format", "json"],
      { cwd: worktree, env: await setupEnvironment(worktree) },
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
  const labeled = containers.find((container) =>
    containerMatchesWorktree(container, worktree),
  );
  if (labeled) return labeled;
  const projectContainers = await composeProjectContainers(worktree);
  return projectContainers.find(
    (container) =>
      !completedSetupContainer(container) &&
      containerMatchesWorktree(container, worktree),
  );
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
    .replace(/^(?:0\.0\.0\.0|127\.0\.0\.1):/, "localhost:")
    .replace(/^\[::\]:/, "localhost:")
    .replace(/^\[::1\]:/, "localhost:");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${normalizedAddress}${normalizedPath}`;
}

function previewOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
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
    const { stdout } = await runRuntimeGit(cwd, [
      "rev-list",
      "--max-parents=0",
      "HEAD",
    ]);
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
