import { type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, join, posix, relative, resolve, sep } from "node:path";
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import {
  commandWithNextWebpackFallback,
  generatePreviewArtifacts,
  parseRunConfigurations,
  type ExecutionTelemetryCohorts,
  type ProjectPreviewRuntimeState,
  type ProjectRunConfiguration,
} from "@blame/agent-runtime";
import {
  parsePreviewManifest,
  type PreviewManifest,
  type PreviewManifestEndpoint,
  type PreviewManifestProbe,
  type PreviewManifestService,
} from "@blame/preview-contract";
import type { RuntimeProfileId } from "@blame/preview-runtime";
import {
  ATTR_BLAME_AGENT_ROLE,
  ATTR_BLAME_AGENT_STRATEGY,
  ATTR_BLAME_EXECUTION_ID,
  ATTR_BLAME_EXECUTION_KIND,
  ATTR_BLAME_EXECUTION_STATUS,
  ATTR_BLAME_MULTI_AGENT_ENABLED,
  ATTR_BLAME_MULTI_AGENT_USED,
  ATTR_BLAME_OPERATION_NAME,
  ATTR_BLAME_REPOSITORY_LANGUAGE,
  ATTR_BLAME_REPOSITORY_SIZE_BUCKET,
  ATTR_BLAME_STORY_ID,
  ATTR_BLAME_TASK_COMPLEXITY_BUCKET,
  ATTR_BLAME_WORKTREE_ID,
  ATTR_ERROR_TYPE,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  boundedMetricDimensionName,
  getBlameTelemetry,
  getExecutionRegistry,
  errorAttributes,
  opaqueIdentifier,
  semanticGenAiProviderName,
  withoutTelemetryEnvironment,
  type BlameSpan,
  type ExecutionComponent,
  type ExecutionDescriptor,
  type TelemetryOutcome,
} from "@blame/telemetry";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  generateNewProjectWithAgent,
  releaseAgentWorkspaceSessions,
} from "./agent-ipc";
import {
  optimizeAttachmentForAiContext,
  type OptimizeAttachmentForAiContextInput,
} from "./attachment-ai-context";
import { cleanupCodeReviewGraphWorktree } from "./code-review-graph";
import { pLimit } from "./concurrency.ts";
import {
  repositoryTelemetryCohorts,
  type RepositoryTelemetryCohorts,
} from "./repository-telemetry-cohorts";
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
  type RuntimeProgress,
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
  previewComposeEnvOverrides,
  validatePreviewComposeBindings,
} from "./preview-compose-validation";
import { previewContainerFailure } from "./preview-readiness";
import {
  initialPreviewRuntimeSelection,
  normalizeStoredRunConfigurations,
  previewRunConfigurationStatus,
  previewRunConfigurationServiceIds,
  selectedPreviewRuntimeServiceIds,
  selectedPreviewRunConfiguration,
  shouldStartBrowserPreview,
  type PreviewRuntimeSelectionState,
} from "./preview-run-state";
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
import { LocalPreviewService } from "./preview-runtime/local/local-preview-service";
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
  excludedGitPathspec,
  gitDiffBetween,
  gitDiffStatsBetween,
  gitDiffFrom,
  gitSnapshot,
  isGitRepository,
  listGitDirectory,
  readGitFile,
  runtimeEnvPath,
  type GitDiffInput,
  type GitDiffFromInput,
  type GitSnapshotInput,
  type GitDirectoryInput,
  type GitFileInput,
} from "./workspace-git";
import { workspaceDiffStats } from "./workspace-diff-stats";
import {
  ignoredGitDiffPathspecs,
  isIgnoredWorkspaceDiffPath,
} from "./workspace-diff-policy";
import {
  appendFile as appendRuntimeFile,
  chmod as chmodRuntime,
  dirnameWorkspacePath,
  hasMissingWorkspaceNodeModules,
  sanitizeWorkspaceConfigFiles,
  joinWorkspacePath,
  mkdir as mkdirRuntime,
  pathExists as runtimePathExists,
  readExistingFiles as readExistingRuntimeFiles,
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
  writeFileAtomic as writeRuntimeFileAtomic,
  findProjectFilesByName,
  resetRuntimeGitIdentityConfigured,
} from "./workspace-runtime";
import {
  workspaceExecution,
  workspaceMode,
  type WorkspaceMode,
} from "./workspace-mode.ts";
import {
  branchExists,
  ensureRuntimeGitSafeDirectory,
  runRuntimeGit,
  worktreeRegistered,
} from "./workspace-runtime-git.ts";
import {
  detectedStackUsesNext,
  packageJsonUsesNext,
} from "./project-stack-detection";
import {
  startWorkspaceStep,
  traceWorkspaceStep,
} from "./workspace-step-telemetry";

const previewStartupIntervalMs = 1_000;
const previewDiscoveryGraceMs = 15_000;
const previewResponseTimeoutMs = 120_000;
const previewRequestTimeoutMs = 5_000;
const previewStopTimeoutSeconds = 3;
const containerMetadataTimeoutMs = 15_000;
const repositoryLanguageCohorts = new Set([
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "go",
  "html",
  "java",
  "javascript",
  "kotlin",
  "mixed",
  "other",
  "php",
  "python",
  "ruby",
  "rust",
  "shell",
  "swift",
  "typescript",
  "vue",
]);
const repositorySizeCohorts = new Set([
  "small",
  "medium",
  "large",
  "very_large",
]);
const taskComplexityCohorts = new Set(["small", "medium", "large"]);
const repositoryTelemetryCache = new Map<
  string,
  Promise<RepositoryTelemetryCohorts | undefined>
>();
const forceKillDelayMs = 1_500;
const previewResolveTimeoutMs = 45_000;
const composeUpRetryDelaysMs = [2_000, 5_000, 10_000, 15_000];
const setupEnvironmentCacheTtlMs = 2_000;
const worktreeSetupOperationName = "blame.worktree.setup";
const projectSetupOperationName = "blame.project.setup";
const previewStartOperationName = "blame.preview.start";
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

type GitLogInput = {
  limit?: number;
  root: string;
  skip?: number;
};

type GitPathInput = {
  path: string;
  root: string;
  staged?: boolean;
};

type GitConflictFileInput = {
  path: string;
  root: string;
};

type GitAcceptConflictFileInput = GitConflictFileInput & {
  side: "current" | "incoming";
};

type GitResolveConflictFileInput = GitConflictFileInput & {
  content?: string;
};

type GitCommitDiffInput = {
  hash: string;
  root: string;
};

type GitFilesInput = {
  paths: string[];
  root: string;
};

type GitCommitInput = {
  message: string;
  root: string;
};

type ExecutionContextInput = {
  executionId: string;
  storyId?: string;
  telemetryCohorts?: ExecutionTelemetryCohorts;
};

type CreateWorktreeInput = ExecutionContextInput & {
  repositoryRoot: string;
  runtimeProfile: RuntimeProfileId;
  storyId: string;
  storyReference: string;
  title: string;
};

type RunProjectSetupInput = ExecutionContextInput & {
  storyId: string;
  worktree: string;
  setupScript: string;
  dockerCompose: string;
  previewManifest?: PreviewManifest;
  runConfigurations?: ProjectRunConfiguration[];
  runConfigurationId?: string;
  hostDependenciesChecked?: boolean;
  runtimeProfile: RuntimeProfileId;
};

type CheckHostDependenciesInput = {
  runtimeProfile?: RuntimeProfileId;
  setupScript: string;
  worktree?: string;
};

type RuntimeOperationInput = {
  operationId?: string;
};

type StopProjectSetupInput = {
  workspaceMode?: WorkspaceMode;
  worktree: string;
};

type ProjectServiceLogsInput = {
  service: string;
  worktree: string;
};

type RemoveWorktreeInput = {
  projectSetupStopped?: boolean;
  repositoryRoot: string;
  workspaceMode?: WorkspaceMode;
  worktree: string;
};

type ResolveProjectPreviewUrlInput = {
  worktree: string;
};

type EnsureProjectPreviewUrlInput = ExecutionContextInput &
  ResolveProjectPreviewUrlInput & {
    workspaceMode?: WorkspaceMode;
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
  processSpan: BlameSpan;
  startedAt: number;
  startLocalPreview: boolean;
  telemetry: ExecutionOperation;
  worktree: string;
};

type ExecutionOperation = {
  component: ExecutionComponent;
  descriptor: ExecutionDescriptor;
  finished: boolean;
  operationName: string;
};

type ProjectSetupFiles = {
  composePath: string;
  directory: string;
  dockerCompose: string;
  manifest?: PreviewManifest;
  manifestPath: string;
  runConfigurations: ProjectRunConfiguration[];
  runConfigurationsPath: string;
  runtimeState: PreviewRuntimeSelectionState;
  runtimeStatePath: string;
  scriptPath: string;
  setupScript: string;
  symlinkEnvMounts: Awaited<ReturnType<typeof envHostFileMounts>>;
  worktree: string;
};

type ControlProjectPreviewInput = {
  action: "start" | "stop" | "restart";
  configurationId?: string;
  worktree: string;
};

type PreviewControlSelection = {
  current?: ProjectRunConfiguration;
  selected: ProjectRunConfiguration;
  worktree: string;
};

type WorktreeCreationContext = {
  branch: string;
  mode: WorkspaceMode;
  repositoryRoot: string;
  startedAt: number;
  timings: Array<{ duration: number; label: string }>;
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

type PreviewRuntimeErrorCode =
  | "preview_container_missing"
  | "preview_container_stopped"
  | "preview_manifest_invalid"
  | "preview_probe_failed"
  | "preview_probe_unsupported"
  | "preview_response_timeout"
  | "preview_url_timeout";

class PreviewRuntimeError extends Error {
  constructor(
    readonly code: PreviewRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PreviewRuntimeError";
  }
}

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
const localPreviewService = new LocalPreviewService();
function runtimeProgressReporter(
  event: IpcMainInvokeEvent,
  operationId?: string,
) {
  if (!operationId || !/^[a-f0-9-]{36}$/.test(operationId)) return undefined;
  const channel = `workspace:runtime-progress:${operationId}`;
  return (progress: RuntimeProgress) => {
    if (event.sender.isDestroyed()) return;
    try {
      event.sender.send(channel, progress);
    } catch {
      return;
    }
  };
}

function registerRuntimeOperationHandler(
  channel: string,
  operation: typeof ensureRuntimeReady,
  onRuntimeReady?: () => void,
) {
  ipcMain.handle(channel, async (event, input: RuntimeOperationInput = {}) => {
    resetRuntimeGitIdentityConfigured();
    const report = await operation({
      env: runtimeManagerEnvironment(),
      onProgress: runtimeProgressReporter(event, input.operationId),
    });
    if (report.status === "ready") onRuntimeReady?.();
    return report;
  });
}

export function registerWorkspaceIpcHandlers(
  input: {
    beforeGitWrite?(worktree: string): Promise<void>;
    onRuntimeReady?(): void;
  } = {},
) {
  setProjectCreationWindowsProvider(() => BrowserWindow.getAllWindows());
  setNewProjectAgentRuntime({ generate: generateNewProjectWithAgent });
  ipcMain.handle("workspace:path-exists", (_event, input: { path: string }) =>
    pathExists(input.path),
  );
  ipcMain.handle(
    "workspace:optimize-attachment-for-ai-context",
    (_event, input: OptimizeAttachmentForAiContextInput) =>
      optimizeAttachmentForAiContext(input),
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
  ipcMain.handle(
    "workspace:git-diff-stats",
    (_event, input: { from?: string; root: string; to?: string }) =>
      gitDiffStats(input),
  );
  ipcMain.handle("workspace:git-diff-between", (_event, input: GitDiffInput) =>
    gitDiffBetween(input),
  );
  ipcMain.handle("workspace:git-diff-from", (_event, input: GitDiffFromInput) =>
    gitDiffFrom(input),
  );
  ipcMain.handle("workspace:git-snapshot", (_event, input: GitSnapshotInput) =>
    gitSnapshot(input),
  );
  ipcMain.handle("workspace:git-status", (_event, input: { root: string }) =>
    gitStatus(input.root),
  );
  ipcMain.handle(
    "workspace:git-commit-count",
    (_event, input: { root: string }) => gitCommitCount(input.root),
  );
  ipcMain.handle("workspace:git-log", (_event, input: GitLogInput) =>
    gitLog(input),
  );
  ipcMain.handle("workspace:git-file-diff", (_event, input: GitPathInput) =>
    gitFileDiff(input),
  );
  ipcMain.handle(
    "workspace:git-commit-diff",
    (_event, input: GitCommitDiffInput) => gitCommitDiff(input),
  );
  ipcMain.handle(
    "workspace:git-conflict-file",
    (_event, input: GitConflictFileInput) => gitConflictFile(input),
  );
  ipcMain.handle(
    "workspace:git-accept-conflict-file",
    (_event, input: GitAcceptConflictFileInput) => gitAcceptConflictFile(input),
  );
  ipcMain.handle(
    "workspace:git-resolve-conflict-file",
    (_event, input: GitResolveConflictFileInput) =>
      gitResolveConflictFile(input),
  );
  ipcMain.handle(
    "workspace:git-abort-conflict",
    (_event, input: { root: string }) => gitAbortConflict(input.root),
  );
  ipcMain.handle(
    "workspace:git-continue-conflict",
    (_event, input: { root: string }) => gitContinueConflict(input.root),
  );
  ipcMain.handle("workspace:git-stage-files", (_event, input: GitFilesInput) =>
    gitStageFiles(input),
  );
  ipcMain.handle(
    "workspace:git-unstage-files",
    (_event, input: GitFilesInput) => gitUnstageFiles(input),
  );
  ipcMain.handle(
    "workspace:git-rollback-files",
    (_event, input: GitFilesInput) => gitRollbackFiles(input),
  );
  ipcMain.handle("workspace:git-delete-files", (_event, input: GitFilesInput) =>
    gitDeleteFiles(input),
  );
  ipcMain.handle("workspace:git-commit", (_event, value: GitCommitInput) =>
    Promise.resolve(input.beforeGitWrite?.(value.root)).then(() =>
      gitCommit(value),
    ),
  );
  ipcMain.handle("workspace:git-push", (_event, value: { root: string }) =>
    Promise.resolve(input.beforeGitWrite?.(value.root)).then(() =>
      gitPush(value.root),
    ),
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
        runtimeProfile: input.runtimeProfile,
        setupScript: input.setupScript,
      }),
  );
  ipcMain.handle("workspace:get-runtime-status", () =>
    getRuntimeStatus({ env: runtimeManagerEnvironment() }),
  );
  registerRuntimeOperationHandler(
    "workspace:ensure-runtime-ready",
    ensureRuntimeReady,
    input.onRuntimeReady,
  );
  registerRuntimeOperationHandler(
    "workspace:repair-runtime",
    repairRuntime,
    input.onRuntimeReady,
  );
  registerRuntimeOperationHandler(
    "workspace:reset-runtime",
    resetRuntime,
    input.onRuntimeReady,
  );
  ipcMain.handle("workspace:uninstall-runtime", async () => {
    resetRuntimeGitIdentityConfigured();
    return uninstallRuntime({ env: runtimeManagerEnvironment() });
  });
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
    (_event, input: EnsureProjectPreviewUrlInput) =>
      ensureProjectPreviewUrl(input),
  );
  ipcMain.handle(
    "workspace:project-runtime-healthy",
    (_event, input: ResolveProjectPreviewUrlInput) =>
      projectRuntimeHealthy(input.worktree),
  );
  ipcMain.handle(
    "workspace:project-preview-runtime-state",
    (_event, input: { worktree: string; workspaceMode?: WorkspaceMode }) =>
      projectPreviewRuntimeState(input.worktree, input.workspaceMode),
  );
  ipcMain.handle(
    "workspace:control-project-preview",
    (_event, input: ControlProjectPreviewInput) =>
      localPreviewService.control(input),
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
  const excludedEnvFiles = await changedRuntimeEnvPathspecs(cwd);
  const { stdout } = await runRuntimeGit(cwd, [
    "diff",
    "--no-ext-diff",
    "--",
    ".",
    ...excludedEnvFiles,
    ...ignoredGitDiffPathspecs,
  ]);
  return stdout;
}

async function gitDiffStats(input: {
  from?: string;
  root: string;
  to?: string;
}) {
  if (input.from && input.to) {
    return gitDiffStatsBetween({
      from: input.from,
      root: input.root,
      to: input.to,
    });
  }
  const cwd = resolveRuntimePath(input.root);
  const excludedEnvFiles = await changedRuntimeEnvPathspecs(cwd);
  const { stdout } = await runRuntimeGit(cwd, [
    "diff",
    "--numstat",
    "--no-ext-diff",
    "--",
    ".",
    ...excludedEnvFiles,
    ...ignoredGitDiffPathspecs,
  ]);
  return workspaceDiffStats(stdout);
}

async function changedRuntimeEnvPathspecs(cwd: string) {
  const { stdout } = await runRuntimeGit(cwd, [
    "ls-files",
    "--modified",
    "--deleted",
    "--others",
    "--exclude-standard",
  ]);
  return stdout
    .split("\n")
    .filter(Boolean)
    .filter(runtimeEnvPath)
    .map(excludedGitPathspec);
}

async function gitStatus(root: string) {
  const cwd = resolveRuntimePath(root);
  const [branch, remotes] = await Promise.all([
    gitBranchStatus(cwd),
    gitRemoteUrls(cwd),
  ]);
  const { stdout } = await runRuntimeGit(cwd, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  return { branch, files: parseGitStatusFiles(stdout), remote: remotes[0] };
}

async function gitLog(input: GitLogInput) {
  const cwd = resolveRuntimePath(input.root);
  const limit = Math.max(1, Math.min(input.limit ?? 200, 5_000));
  const skip = Math.max(0, input.skip ?? 0);
  try {
    const { stdout } = await runRuntimeGit(cwd, [
      "log",
      "--all",
      "--decorate=short",
      `--max-count=${limit}`,
      `--skip=${skip}`,
      "--date=iso-strict",
      "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%ad%x1f%D%x1f%s%x1e",
    ]);
    return parseGitLog(stdout);
  } catch {
    return [];
  }
}

async function gitCommitCount(root: string) {
  const cwd = resolveRuntimePath(root);
  try {
    const { stdout } = await runRuntimeGit(cwd, [
      "rev-list",
      "--all",
      "--count",
    ]);
    return Number(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

async function gitFileDiff(input: GitPathInput) {
  const cwd = resolveRuntimePath(input.root);
  const path = gitWorkspacePath(input.path);
  if (isIgnoredWorkspaceDiffPath(path)) return "";
  const args = input.staged
    ? [
        "diff",
        "--cached",
        "--no-ext-diff",
        "--",
        path,
        ...ignoredGitDiffPathspecs,
      ]
    : ["diff", "--no-ext-diff", "--", path, ...ignoredGitDiffPathspecs];
  const { stdout } = await runRuntimeGit(cwd, args);
  if (stdout || input.staged || !(await gitPathIsUntracked(cwd, path)))
    return stdout;
  return untrackedGitDiff(cwd, path);
}

async function gitCommitDiff(input: GitCommitDiffInput) {
  const cwd = resolveRuntimePath(input.root);
  const hash = gitHash(input.hash);
  try {
    const { stdout } = await runRuntimeGit(cwd, [
      "diff",
      "--no-ext-diff",
      `${hash}^`,
      hash,
      "--",
      ...ignoredGitDiffPathspecs,
    ]);
    return stdout;
  } catch {
    const { stdout } = await runRuntimeGit(cwd, [
      "show",
      "--format=",
      "--no-ext-diff",
      hash,
      "--",
      ...ignoredGitDiffPathspecs,
    ]);
    return stdout;
  }
}

async function gitConflictFile(input: GitConflictFileInput) {
  const cwd = resolveRuntimePath(input.root);
  const path = gitWorkspacePath(input.path);
  return {
    base: await gitConflictStage(cwd, path, 1),
    current: await gitConflictStage(cwd, path, 2),
    incoming: await gitConflictStage(cwd, path, 3),
    path,
    result: await gitConflictResult(cwd, path),
  };
}

async function gitAcceptConflictFile(input: GitAcceptConflictFileInput) {
  const cwd = resolveRuntimePath(input.root);
  const path = gitWorkspacePath(input.path);
  await runRuntimeGit(cwd, [
    "checkout",
    input.side === "current" ? "--ours" : "--theirs",
    "--",
    path,
  ]);
  await runRuntimeGit(cwd, ["add", "--", path]);
  return true;
}

async function gitResolveConflictFile(input: GitResolveConflictFileInput) {
  const cwd = resolveRuntimePath(input.root);
  const path = gitWorkspacePath(input.path);
  if (input.content !== undefined) {
    await writeRuntimeFile(joinWorkspacePath(cwd, path), input.content);
  }
  await runRuntimeGit(cwd, ["add", "--", path]);
  return true;
}

async function gitAbortConflict(root: string) {
  const cwd = resolveRuntimePath(root);
  return gitConflictCommand(cwd, [
    ["merge", "--abort"],
    ["rebase", "--abort"],
    ["cherry-pick", "--abort"],
    ["revert", "--abort"],
  ]);
}

async function gitContinueConflict(root: string) {
  const cwd = resolveRuntimePath(root);
  return gitConflictCommand(cwd, [
    ["-c", "core.editor=true", "merge", "--continue"],
    ["-c", "core.editor=true", "rebase", "--continue"],
    ["-c", "core.editor=true", "cherry-pick", "--continue"],
    ["-c", "core.editor=true", "revert", "--continue"],
  ]);
}

async function gitStageFiles(input: GitFilesInput) {
  const cwd = resolveRuntimePath(input.root);
  const paths = gitWorkspacePaths(input.paths);
  if (paths.length === 0) return false;
  await runRuntimeGit(cwd, ["add", "--", ...paths]);
  return true;
}

async function gitConflictStage(cwd: string, path: string, stage: number) {
  try {
    const { stdout } = await runRuntimeGit(cwd, ["show", `:${stage}:${path}`]);
    return stdout;
  } catch {
    return "";
  }
}

async function gitConflictResult(cwd: string, path: string) {
  try {
    return await readRuntimeFile(joinWorkspacePath(cwd, path));
  } catch {
    return "";
  }
}

async function gitConflictCommand(cwd: string, commands: string[][]) {
  let lastError: unknown;
  for (const command of commands) {
    try {
      const result = await runRuntimeGit(cwd, command);
      return { output: result.stdout || result.stderr };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("Unable to complete Git conflict command");
}

async function gitUnstageFiles(input: GitFilesInput) {
  const cwd = resolveRuntimePath(input.root);
  const paths = gitWorkspacePaths(input.paths);
  if (paths.length === 0) return false;
  await runRuntimeGit(cwd, ["restore", "--staged", "--", ...paths]);
  return true;
}

async function gitRollbackFiles(input: GitFilesInput) {
  const cwd = resolveRuntimePath(input.root);
  const paths = gitWorkspacePaths(input.paths);
  if (paths.length === 0) return false;
  await runRuntimeGit(cwd, [
    "restore",
    "--staged",
    "--worktree",
    "--",
    ...paths,
  ]);
  return true;
}

async function gitDeleteFiles(input: GitFilesInput) {
  const cwd = resolveRuntimePath(input.root);
  const paths = gitWorkspacePaths(input.paths);
  if (paths.length === 0) return false;
  await Promise.all(
    paths.map((path) => rmRuntime(joinWorkspacePath(cwd, path))),
  );
  return true;
}

async function gitCommit(input: GitCommitInput) {
  const cwd = resolveRuntimePath(input.root);
  const message = input.message.trim();
  if (!message) throw new Error("Commit message is required");
  const result = await runRuntimeGit(cwd, [
    "commit",
    "--no-gpg-sign",
    "-m",
    message,
  ]);
  return { output: result.stdout || result.stderr };
}

async function gitPush(root: string) {
  const cwd = resolveRuntimePath(root);
  const result = await runRuntimeGit(cwd, ["push"]);
  return { output: result.stdout || result.stderr };
}

async function gitBranchStatus(cwd: string) {
  const { stdout } = await runRuntimeGit(cwd, [
    "status",
    "--porcelain=v2",
    "--branch",
    "--untracked-files=no",
  ]);
  return parseGitBranchStatus(stdout);
}

function parseGitBranchStatus(output: string) {
  const branch = { ahead: 0, behind: 0, current: "HEAD", detached: true };
  let oid = "";
  let head = "";
  let upstream: string | undefined;
  for (const line of output.split("\n")) {
    if (line.startsWith("# branch.oid ")) oid = line.slice(13).trim();
    if (line.startsWith("# branch.head ")) head = line.slice(14).trim();
    if (line.startsWith("# branch.upstream ")) upstream = line.slice(18).trim();
    if (line.startsWith("# branch.ab "))
      parseGitBranchAheadBehind(line, branch);
  }
  return {
    ...branch,
    current: head && head !== "(detached)" ? head : oid.slice(0, 7) || "HEAD",
    detached: !head || head === "(detached)",
    upstream,
  };
}

function parseGitBranchAheadBehind(
  line: string,
  branch: { ahead: number; behind: number },
) {
  const match = line.match(/\+(\d+)\s+-(\d+)/);
  if (!match) return;
  branch.ahead = Number(match[1]);
  branch.behind = Number(match[2]);
}

function parseGitStatusFiles(output: string) {
  const records = output.split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.length < 4) continue;
    const indexStatus = record[0];
    const worktreeStatus = record[1];
    const originalPath = renamedGitStatus(indexStatus)
      ? records[index + 1]
      : undefined;
    if (originalPath) index += 1;
    files.push(
      gitStatusFile(record.slice(3), originalPath, indexStatus, worktreeStatus),
    );
  }
  return files.filter((file) => !isIgnoredWorkspaceDiffPath(file.path));
}

function gitStatusFile(
  path: string,
  originalPath: string | undefined,
  indexStatus: string,
  worktreeStatus: string,
) {
  return {
    conflicted: gitStatusConflicted(indexStatus, worktreeStatus),
    indexStatus,
    originalPath,
    path,
    staged: gitStatusStaged(indexStatus),
    status: gitFileStatus(indexStatus, worktreeStatus),
    untracked: indexStatus === "?" && worktreeStatus === "?",
    unstaged: gitStatusUnstaged(indexStatus, worktreeStatus),
    worktreeStatus,
  };
}

function renamedGitStatus(status: string) {
  return status === "R" || status === "C";
}

function gitStatusStaged(status: string) {
  return status !== " " && status !== "?" && status !== "!";
}

function gitStatusUnstaged(indexStatus: string, worktreeStatus: string) {
  if (indexStatus === "?" && worktreeStatus === "?") return true;
  return worktreeStatus !== " " && worktreeStatus !== "!";
}

function gitFileStatus(indexStatus: string, worktreeStatus: string) {
  if (indexStatus === "?" && worktreeStatus === "?") return "untracked";
  if (gitStatusConflicted(indexStatus, worktreeStatus)) return "conflict";
  const status = indexStatus !== " " ? indexStatus : worktreeStatus;
  if (status === "A") return "added";
  if (status === "D") return "deleted";
  if (status === "R") return "renamed";
  if (status === "C") return "copied";
  return "modified";
}

function gitStatusConflicted(indexStatus: string, worktreeStatus: string) {
  return ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
    `${indexStatus}${worktreeStatus}`,
  );
}

function parseGitLog(output: string) {
  return output
    .split("\x1e")
    .map(parseGitLogRecord)
    .filter((commit) => commit !== undefined);
}

function parseGitLogRecord(record: string) {
  const parts = record.replace(/^\n+|\n+$/g, "").split("\x1f");
  if (parts.length < 7 || !parts[0]) return undefined;
  return {
    authorEmail: parts[3],
    authorName: parts[2],
    date: parts[4],
    hash: parts[0],
    message: parts.slice(6).join("\x1f"),
    parents: parts[1].split(" ").filter(Boolean),
    refs: parseGitRefs(parts[5]),
  };
}

function parseGitRefs(value: string) {
  return value
    .split(",")
    .map((ref) => ref.trim())
    .filter(Boolean)
    .map((ref) => ({ name: gitRefName(ref), type: gitRefType(ref) }));
}

function gitRefName(ref: string) {
  if (ref.startsWith("HEAD -> ")) return ref.slice(8);
  if (ref.startsWith("tag: ")) return ref.slice(5);
  return ref;
}

function gitRefType(ref: string) {
  if (ref === "HEAD" || ref.startsWith("HEAD -> ")) return "head";
  if (ref.startsWith("tag: ")) return "tag";
  if (ref.includes("/")) return "remote";
  return "branch";
}

function gitWorkspacePaths(paths: string[]) {
  return [...new Set(paths.map(gitWorkspacePath))];
}

function gitWorkspacePath(value: string) {
  const normalized = posix.normalize(value.replaceAll("\\", "/"));
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.startsWith("/") ||
    normalized.includes("\0")
  ) {
    throw new Error("Path escapes workspace");
  }
  return normalized;
}

function gitHash(value: string) {
  if (!/^[0-9a-f]{7,40}$/i.test(value)) throw new Error("Invalid Git hash");
  return value;
}

async function gitPathIsUntracked(cwd: string, path: string) {
  const { stdout } = await runRuntimeGit(cwd, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    path,
  ]);
  return stdout.split("\n").some((line) => line.trim() === path);
}

async function untrackedGitDiff(cwd: string, path: string) {
  try {
    const { stdout } = await runRuntimeGit(cwd, [
      "diff",
      "--no-ext-diff",
      "--no-index",
      "--",
      gitEmptyFilePath(cwd),
      path,
    ]);
    return stdout;
  } catch (error) {
    return commandText(error, "stdout");
  }
}

function gitEmptyFilePath(cwd: string) {
  if (process.platform === "win32" && !runtimeManagedPath(cwd)) return "NUL";
  return "/dev/null";
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
  const operation = beginExecutionOperation(
    input,
    worktreeSetupOperationName,
    createWorktreePath(input),
  );
  const cohorts = enrichExecutionRepositoryCohorts(
    operation,
    input.repositoryRoot,
  );
  return runExecutionOperation(operation, async () => {
    const result = await createWorktreeOperation(input);
    await waitForRepositoryCohorts(cohorts);
    return result;
  });
}

async function createWorktreeOperation(input: CreateWorktreeInput) {
  const context = worktreeCreationContext(input);
  await prepareWorktreeCreation(context);
  if (await reuseRegisteredWorktree(context)) return worktreeResult(context);
  await assertWorktreePathAvailable(context);
  await addStoryWorktree(context);
  await completeWorktreeCreation(context);
  return worktreeResult(context);
}

function worktreeCreationContext(
  input: CreateWorktreeInput,
): WorktreeCreationContext {
  const mode = workspaceMode(input.runtimeProfile);
  return {
    branch: storyBranch(input.storyReference, input.title),
    mode,
    repositoryRoot: resolveRuntimePath(input.repositoryRoot),
    startedAt: Date.now(),
    timings: [],
    worktree: createWorktreePath(input),
  };
}

async function prepareWorktreeCreation(context: WorktreeCreationContext) {
  const { mode, repositoryRoot, timings, worktree } = context;
  if (mode === "local-container") {
    await timedWorktreeCreateStep(timings, "git safe directory", () =>
      ensureRuntimeGitSafeDirectory(repositoryRoot),
    );
  }
  await timedWorktreeCreateStep(timings, "git repository ensure", () =>
    ensureWorkspaceGitRepository(repositoryRoot),
  );
  await timedWorktreeCreateStep(timings, "worktree parent mkdir", () =>
    mkdirRuntime(dirnameWorkspacePath(worktree)),
  );
}

async function reuseRegisteredWorktree(context: WorktreeCreationContext) {
  const { mode, repositoryRoot, timings, worktree } = context;
  const registered = await timedWorktreeCreateStep(
    timings,
    "worktree registered check",
    () => worktreeRegistered(repositoryRoot, worktree, mode),
  );
  if (!registered) return false;
  await completeWorktreeCreation(context);
  return true;
}

async function assertWorktreePathAvailable(context: WorktreeCreationContext) {
  const exists = await timedWorktreeCreateStep(
    context.timings,
    "worktree path exists check",
    () => runtimePathExists(context.worktree),
  );
  if (exists)
    throw new Error("Worktree directory already exists but is not registered");
}

async function addStoryWorktree(context: WorktreeCreationContext) {
  const { branch, mode, repositoryRoot, timings, worktree } = context;
  const existing = await timedWorktreeCreateStep(
    timings,
    "branch exists check",
    () => branchExists(repositoryRoot, branch, mode),
  );
  const label = existing
    ? "git worktree add existing branch"
    : "git worktree add new branch";
  const args = existing
    ? ["worktree", "add", worktree, branch]
    : ["worktree", "add", "-b", branch, worktree, "HEAD"];
  await timedWorktreeCreateStep(timings, label, () =>
    runRuntimeGit(repositoryRoot, args, workspaceExecution(mode)),
  );
}

async function completeWorktreeCreation(context: WorktreeCreationContext) {
  const { repositoryRoot, startedAt, timings, worktree } = context;
  await timedWorktreeCreateStep(timings, "env sync", () =>
    syncProjectEnvFiles(repositoryRoot, worktree),
  );
  invalidateSetupEnvironment(worktree);
  removedWorktrees.delete(worktree);
  await appendWorktreeCreateTimings(worktree, timings, startedAt);
}

function worktreeResult(context: WorktreeCreationContext) {
  return {
    branch: context.branch,
    workspaceMode: context.mode,
    worktree: context.worktree,
  };
}

function createWorktreePath(input: CreateWorktreeInput) {
  return worktreePath({
    mode: workspaceMode(input.runtimeProfile),
    repositoryRoot: input.repositoryRoot,
    storyId: input.storyReference,
    title: input.title,
  });
}

async function timedWorktreeCreateStep<T>(
  timings: Array<{ duration: number; label: string }>,
  label: string,
  action: () => Promise<T> | T,
) {
  const start = Date.now();
  try {
    return await traceWorkspaceStep(label, action);
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

function beginExecutionOperation(
  input: ExecutionContextInput,
  operationName: string,
  worktree?: string,
): ExecutionOperation {
  const descriptor = executionDescriptor(input, worktree);
  const component = getExecutionRegistry().beginComponent(
    descriptor,
    operationName,
    { [ATTR_BLAME_OPERATION_NAME]: operationName },
  );
  return {
    component,
    descriptor,
    finished: false,
    operationName,
  };
}

async function runExecutionOperation<T>(
  operation: ExecutionOperation,
  action: () => Promise<T>,
  outcome = (_result: T): TelemetryOutcome => "succeeded",
) {
  return getBlameTelemetry().withinSpan(operation.component.span, async () => {
    try {
      const result = await action();
      finishExecutionOperation(operation, outcome(result));
      return result;
    } catch (error) {
      finishExecutionOperation(operation, "failed", error);
      throw error;
    }
  });
}

function finishExecutionOperation(
  operation: ExecutionOperation,
  outcome: TelemetryOutcome,
  error?: unknown,
) {
  if (operation.finished) return;
  operation.finished = true;
  recordOperationMetrics(
    operation.component.span,
    operation.operationName,
    outcome,
    error,
    operation.descriptor,
  );
  if (outcome === "failed") operation.component.fail(error ?? new Error());
  else if (outcome === "canceled") operation.component.cancel();
  else operation.component.succeed();
}

function executionDescriptor(
  input: ExecutionContextInput,
  worktree?: string,
): ExecutionDescriptor {
  return {
    attributes: executionCohortAttributes(input.telemetryCohorts),
    executionId: input.executionId,
    storyId: input.storyId,
    worktreeId: worktree ? opaqueIdentifier(worktree) : undefined,
  };
}

function executionCohortAttributes(
  cohorts: ExecutionTelemetryCohorts | undefined,
) {
  const workspaceAttributes = { [ATTR_BLAME_EXECUTION_KIND]: "workspace" };
  if (!cohorts) return workspaceAttributes;
  const strategy = boundedAgentStrategy(cohorts.agentStrategy);
  return {
    ...workspaceAttributes,
    [ATTR_BLAME_AGENT_ROLE]: "lead",
    [ATTR_BLAME_AGENT_STRATEGY]: strategy,
    [ATTR_BLAME_MULTI_AGENT_ENABLED]: strategy === "multi_agent",
    [ATTR_BLAME_MULTI_AGENT_USED]: false,
    [ATTR_BLAME_REPOSITORY_LANGUAGE]: boundedRepositoryLanguage(
      cohorts.repositoryLanguage,
    ),
    [ATTR_BLAME_REPOSITORY_SIZE_BUCKET]: boundedCohortValue(
      cohorts.repositorySizeBucket,
      repositorySizeCohorts,
    ),
    [ATTR_BLAME_TASK_COMPLEXITY_BUCKET]: boundedCohortValue(
      cohorts.taskComplexityBucket,
      taskComplexityCohorts,
    ),
    [ATTR_GEN_AI_PROVIDER_NAME]: semanticGenAiProviderName(cohorts.providerId),
    [ATTR_GEN_AI_REQUEST_MODEL]: boundedMetricDimensionName(cohorts.modelId),
  };
}

function boundedAgentStrategy(value: string) {
  return value === "multi_agent" ? value : "single_agent";
}

function boundedRepositoryLanguage(value: string | undefined) {
  if (!value) return undefined;
  return repositoryLanguageCohorts.has(value) ? value : "other";
}

function boundedCohortValue(value: string | undefined, allowed: Set<string>) {
  return value && allowed.has(value) ? value : undefined;
}

async function enrichExecutionRepositoryCohorts(
  operation: ExecutionOperation,
  repositoryRoot: string,
) {
  const cohorts = await loadRepositoryTelemetryCohorts(repositoryRoot);
  if (!cohorts) return;
  const attributes = {
    [ATTR_BLAME_REPOSITORY_LANGUAGE]: cohorts.repositoryLanguage,
    [ATTR_BLAME_REPOSITORY_SIZE_BUCKET]: cohorts.repositorySizeBucket,
  };
  operation.descriptor.attributes = {
    ...operation.descriptor.attributes,
    ...attributes,
  };
  getExecutionRegistry().setAttributes(
    operation.descriptor.executionId,
    attributes,
  );
}

function loadRepositoryTelemetryCohorts(repositoryRoot: string) {
  const root = resolveRuntimePath(repositoryRoot);
  const cached = repositoryTelemetryCache.get(root);
  if (cached) return cached;
  const pending = readRepositoryTelemetryCohorts(root);
  repositoryTelemetryCache.set(root, pending);
  void pending.then((cohorts) => {
    if (!cohorts) repositoryTelemetryCache.delete(root);
  });
  return pending;
}

async function readRepositoryTelemetryCohorts(root: string) {
  try {
    const result = await runRuntime("git", ["ls-files", "-z"], { cwd: root });
    return repositoryTelemetryCohorts(result.stdout);
  } catch {
    return undefined;
  }
}

async function waitForRepositoryCohorts(preparation: Promise<void>) {
  let timeout: NodeJS.Timeout | undefined;
  const deadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, 100);
  });
  await Promise.race([preparation, deadline]);
  if (timeout) clearTimeout(timeout);
}

async function runProjectSetup(input: RunProjectSetupInput) {
  const operation = beginExecutionOperation(
    input,
    projectSetupOperationName,
    input.worktree,
  );
  void enrichExecutionRepositoryCohorts(operation, input.worktree);
  try {
    return await getBlameTelemetry().withinSpan(operation.component.span, () =>
      runProjectSetupOperation(input, operation),
    );
  } catch (error) {
    finishExecutionOperation(operation, "failed", error);
    throw error;
  }
}

async function runProjectSetupOperation(
  input: RunProjectSetupInput,
  operation: ExecutionOperation,
) {
  const worktree = resolveRuntimePath(input.worktree);
  const env = await setupEnvironment(worktree);
  if (!input.previewManifest) {
    throw new PreviewRuntimeError(
      "preview_manifest_invalid",
      "A canonical preview manifest is required",
    );
  }
  const manifest = parsePreviewManifest(input.previewManifest);
  const generated = generatePreviewArtifacts(manifest);
  const dockerCompose = generated.dockerCompose;
  const runConfigurations = containerizedRunConfigurations(
    parseRunConfigurations(input.runConfigurations ?? []),
    manifest,
  );
  validateContainerizedRunConfigurations(runConfigurations, manifest);
  const setupScript = setupScriptWithoutDockerRuntimeChecks(
    generated?.setupScript ?? input.setupScript,
  );
  await validateProjectSetup(
    worktree,
    setupScript,
    env,
    input.hostDependenciesChecked,
    input.runtimeProfile,
  );
  const scriptPath = await prepareProjectSetupFiles(
    worktree,
    setupScript,
    dockerCompose,
    manifest,
    runConfigurations,
    input.runConfigurationId,
  );
  return timedRecoveryStep(worktree, "setup process spawn", () =>
    startProjectSetupProcess(
      worktree,
      scriptPath,
      env,
      operation,
      input.runtimeProfile === "local-container",
    ),
  );
}

async function validateProjectSetup(
  worktree: string,
  setupScript: string,
  env: NodeJS.ProcessEnv,
  hostDependenciesChecked?: boolean,
  runtimeProfile?: RuntimeProfileId,
) {
  if (!hostDependenciesChecked) {
    await timedRecoveryStep(worktree, "host dependencies", () =>
      assertHostDependencies({ env, runtimeProfile, setupScript }),
    );
  }
  await timedRecoveryStep(worktree, "git repository check", () =>
    assertGitRepository(worktree),
  );
}

async function prepareProjectSetupFiles(
  worktree: string,
  setupScript: string,
  dockerCompose: string,
  previewManifest?: PreviewManifest,
  runConfigurations: ProjectRunConfiguration[] = [],
  runConfigurationId?: string,
) {
  const directory = joinWorkspacePath(worktree, ".blame", "initialization");
  const scriptPath = joinWorkspacePath(directory, "setup.sh");
  const composePath = joinWorkspacePath(directory, "docker-compose.yml");
  const manifestPath = joinWorkspacePath(directory, "preview-manifest.json");
  const runConfigurationsPath = joinWorkspacePath(
    directory,
    "run-configurations.json",
  );
  const runtimeStatePath = joinWorkspacePath(
    directory,
    "preview-runtime-state.json",
  );
  const logPath = setupLogPath(worktree);
  await mkdirRuntime(dirnameWorkspacePath(logPath));
  await writeRuntimeFile(logPath, "");
  const symlinkEnvMounts = await timedRecoveryStep(
    worktree,
    "env file scan",
    () => envHostFileMounts(worktree),
  );
  await writeProjectSetupFiles({
    composePath,
    directory,
    dockerCompose,
    manifest: previewManifest
      ? parsePreviewManifest(previewManifest)
      : undefined,
    manifestPath,
    runConfigurations,
    runConfigurationsPath,
    runtimeState: initialPreviewRuntimeSelection(
      runConfigurations,
      runConfigurationId,
    ),
    runtimeStatePath,
    scriptPath,
    setupScript,
    symlinkEnvMounts,
    worktree,
  });
  return scriptPath;
}

function containerizedRunConfigurations(
  configurations: ProjectRunConfiguration[],
  manifest: PreviewManifest,
) {
  const previews = manifest.services.filter(
    (service) =>
      service.kind === "preview" &&
      service.endpoints.some(({ protocol }) => protocol !== "tcp"),
  );
  const normalized = configurations.map((configuration) =>
    containerizedRunConfiguration(configuration, previews),
  );
  const represented = new Set(
    normalized.flatMap(({ services }) => services ?? []),
  );
  const usedIds = new Set(normalized.map(({ id }) => id));
  const generated = previews
    .filter(({ id }) => !represented.has(id))
    .map((service, index) =>
      previewServiceRunConfiguration(
        service,
        usedIds,
        !normalized.some(({ default: isDefault }) => isDefault) && index === 0,
      ),
    );
  return [...normalized, ...generated];
}

function validateContainerizedRunConfigurations(
  configurations: ProjectRunConfiguration[],
  manifest: PreviewManifest,
) {
  const serviceIds = new Set(manifest.services.map(({ id }) => id));
  for (const configuration of configurations) {
    for (const service of configuration.services ?? []) {
      if (!serviceIds.has(service)) {
        throw new PreviewRuntimeError(
          "preview_manifest_invalid",
          `Run configuration ${configuration.id} references unknown service ${service}`,
        );
      }
    }
  }
}

function containerizedRunConfiguration(
  configuration: ProjectRunConfiguration,
  previews: PreviewManifestService[],
) {
  if (configuration.category && configuration.category !== "web") {
    return configuration;
  }
  const preview = matchingPreviewService(configuration, previews);
  if (!preview) return configuration;
  return {
    ...configuration,
    category: configuration.category ?? "web",
    previewService: preview.id,
    scopes: configuration.scopes?.length
      ? configuration.scopes
      : [configuration.cwd, preview.id],
    services: [preview.id],
  } satisfies ProjectRunConfiguration;
}

function matchingPreviewService(
  configuration: ProjectRunConfiguration,
  previews: PreviewManifestService[],
) {
  const port = runConfigurationPreviewPort(configuration.previewUrl);
  const explicit =
    previews.find(({ id }) => id === configuration.previewService) ??
    previews.find(({ id }) => configuration.services?.includes(id)) ??
    previews.find((service) =>
      service.endpoints.some((endpoint) => endpoint.port === port),
    );
  if (explicit || configuration.category === "web") return explicit;
  return previews.length === 1 ? previews[0] : undefined;
}

function runConfigurationPreviewPort(value: string | undefined) {
  try {
    return value ? Number(new URL(value).port) : undefined;
  } catch {
    return undefined;
  }
}

function previewServiceRunConfiguration(
  service: PreviewManifestService,
  usedIds: Set<string>,
  isDefault: boolean,
) {
  const id = uniqueRunConfigurationId(service.id, usedIds);
  const endpoint = service.endpoints.find(({ protocol }) => protocol !== "tcp");
  usedIds.add(id);
  return {
    id,
    name: service.id.replace(/[_.-]+/g, " "),
    command: service.command ?? "container service",
    cwd: workspaceRunConfigurationCwd(service.workingDir),
    default: isDefault,
    category: "web" as const,
    services: [service.id],
    previewService: service.id,
    scopes: [service.id, workspaceRunConfigurationCwd(service.workingDir)],
    previewUrl: `${endpoint?.protocol ?? "http"}://localhost:${endpoint?.port ?? 80}`,
  };
}

function uniqueRunConfigurationId(serviceId: string, usedIds: Set<string>) {
  if (!usedIds.has(serviceId)) return serviceId;
  let index = 2;
  while (usedIds.has(`${serviceId}-${index}`)) index += 1;
  return `${serviceId}-${index}`;
}

function workspaceRunConfigurationCwd(workingDirectory: string | undefined) {
  if (!workingDirectory || workingDirectory === "/workspace") return ".";
  return workingDirectory.replace(/^\/workspace\/?/, "") || ".";
}

async function writeProjectSetupFiles(input: ProjectSetupFiles) {
  await timedRecoveryStep(input.worktree, "initialization files", async () => {
    await timedRecoveryStep(
      input.worktree,
      "initialization directory mkdir",
      () => mkdirRuntime(input.directory),
    );
    await timedRecoveryStep(input.worktree, "setup script write", () =>
      writeRuntimeFile(input.scriptPath, input.setupScript),
    );
    const compose = await prepareProjectSetupCompose(input);
    await timedRecoveryStep(input.worktree, "compose file write", () =>
      writeRuntimeFile(input.composePath, compose),
    );
    await timedRecoveryStep(input.worktree, "preview manifest write", () =>
      writeProjectPreviewManifest(input),
    );
    await timedRecoveryStep(input.worktree, "run configurations write", () =>
      writePreviewRuntimeFiles(input),
    );
    await timedRecoveryStep(input.worktree, "setup script chmod", () =>
      chmodRuntime(input.scriptPath, 0o755),
    );
  });
}

async function writePreviewRuntimeFiles(input: ProjectSetupFiles) {
  await writeRuntimeJson(input.runConfigurationsPath, input.runConfigurations);
  await writeRuntimeJson(input.runtimeStatePath, input.runtimeState);
}

function writeRuntimeJson(path: string, value: unknown) {
  return writeRuntimeFileAtomic(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeProjectPreviewManifest(input: ProjectSetupFiles) {
  if (!input.manifest) {
    await rmRuntime(input.manifestPath);
    return;
  }
  await writeRuntimeFile(
    input.manifestPath,
    `${JSON.stringify(input.manifest, null, 2)}\n`,
  );
}

function prepareProjectSetupCompose(input: ProjectSetupFiles) {
  return timedRecoveryStep(input.worktree, "compose prepare", () =>
    prepareProjectCompose(
      input.worktree,
      input.dockerCompose,
      input.symlinkEnvMounts,
    ),
  );
}

function startProjectSetupProcess(
  worktree: string,
  scriptPath: string,
  env: NodeJS.ProcessEnv,
  telemetry: ExecutionOperation,
  startLocalPreview: boolean,
) {
  const runId = randomUUID();
  const child = spawnRuntime("bash", [scriptPath], {
    cwd: worktree,
    env,
  });
  const processSpan = startWorkspaceStep(
    "setup process runtime",
    telemetry.component.span.context,
  );
  trackWorkspaceProcess(child);
  setupRuns.set(runId, {
    id: runId,
    process: child,
    processSpan,
    startedAt: Date.now(),
    startLocalPreview,
    telemetry,
    worktree,
  });
  registerProjectSetupProcessEvents(child, runId, worktree);
  return { runId };
}

function registerProjectSetupProcessEvents(
  child: ChildProcessWithoutNullStreams,
  runId: string,
  worktree: string,
) {
  child.stdout.on("data", (data: Buffer) =>
    emitSetupOutput(runId, worktree, "stdout", data.toString()),
  );
  child.stderr.on("data", (data: Buffer) =>
    emitSetupOutput(runId, worktree, "stderr", data.toString()),
  );
  child.once("error", (error) => {
    failProjectSetupProcess(runId, worktree, error);
  });
  child.on("exit", (code) => {
    void completeProjectSetup(runId, worktree, code);
  });
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
  if (!run) return;
  finishSetupProcessSpan(run, code);
  await getBlameTelemetry().withinSpan(
    run.telemetry.component.span,
    async () => {
      run.telemetry.component.span.setAttributes({
        "process.exit.code": code ?? -1,
      });
      await appendTimingLog(
        worktree,
        "setup process runtime",
        Date.now() - run.startedAt,
      );
      if (code === 0) return completeSuccessfulProjectSetup(run);
      finishSetupRun(run, "failed", new Error("Project setup process failed"));
      emitSetupOutput(runId, worktree, "exit", String(code ?? ""));
    },
  );
}

function finishSetupProcessSpan(run: SetupRun, code: number | null) {
  const outcome = code === 0 ? "succeeded" : "failed";
  run.processSpan.setAttributes({
    "process.exit.code": code ?? -1,
    ...(outcome === "failed" ? { [ATTR_ERROR_TYPE]: "Error" } : {}),
  });
  run.processSpan.end(outcome);
}

async function completeSuccessfulProjectSetup(run: SetupRun) {
  const { id: runId, worktree } = run;
  try {
    const previewUrl = run.startLocalPreview
      ? await traceSetupPreview(run, () => completeSetupPreview(worktree))
      : null;
    finishSetupRun(run, "succeeded");
    emitSetupOutput(
      runId,
      worktree,
      "stdout",
      previewUrl
        ? "Project preview containers are running.\n"
        : "Project runtime is ready.\n",
    );
    emitSetupOutput(runId, worktree, "exit", "0");
  } catch (error) {
    await stopProjectLogStream(worktree);
    finishSetupRun(run, "failed", error);
    emitSetupOutput(runId, worktree, "stderr", errorMessage(error));
    emitSetupOutput(runId, worktree, "exit", "1");
  }
}

async function completeSetupPreview(worktree: string) {
  return startProjectCompose(worktree);
}

function failProjectSetupProcess(
  runId: string,
  worktree: string,
  error: unknown,
) {
  const run = setupRuns.get(runId);
  if (!run) return;
  finishSetupRun(run, "failed", error);
  emitSetupOutput(runId, worktree, "stderr", errorMessage(error));
  emitSetupOutput(runId, worktree, "exit", "1");
}

function finishSetupRun(
  run: SetupRun,
  outcome: TelemetryOutcome,
  error?: unknown,
) {
  setupRuns.delete(run.id);
  run.processSpan.end(outcome);
  finishExecutionOperation(run.telemetry, outcome, error);
}

async function traceSetupPreview<T>(run: SetupRun, action: () => Promise<T>) {
  const telemetry = getBlameTelemetry();
  const operationName = previewStartOperationName;
  const span = telemetry.startSpan(operationName, {
    attributes: operationSpanAttributes(
      run.telemetry.descriptor,
      operationName,
    ),
    parent: run.telemetry.component.span.context,
  });
  return telemetry.withinSpan(span, () =>
    runSpanOperation(span, operationName, run.telemetry.descriptor, action),
  );
}

async function runSpanOperation<T>(
  span: BlameSpan,
  operationName: string,
  descriptor: ExecutionDescriptor,
  action: () => Promise<T>,
) {
  try {
    const result = await action();
    recordOperationMetrics(
      span,
      operationName,
      "succeeded",
      undefined,
      descriptor,
    );
    span.end("succeeded");
    return result;
  } catch (error) {
    span.recordError(error);
    recordOperationMetrics(span, operationName, "failed", error, descriptor);
    span.end("failed");
    throw error;
  }
}

function recordOperationMetrics(
  span: BlameSpan,
  operationName: string,
  outcome: TelemetryOutcome,
  error?: unknown,
  descriptor?: ExecutionDescriptor,
) {
  const attributes = operationMetricAttributes(
    operationName,
    outcome,
    error,
    descriptor,
  );
  const telemetry = getBlameTelemetry();
  telemetry.count(`${operationName}.count`, 1, attributes, span.context);
  telemetry.record(
    `${operationName}.duration`,
    span.durationSeconds(),
    attributes,
    span.context,
  );
  recordOperationLog(span, outcome, attributes, error);
}

function operationMetricAttributes(
  operationName: string,
  outcome: TelemetryOutcome,
  error?: unknown,
  descriptor?: ExecutionDescriptor,
) {
  return {
    ...metricCohortAttributes(descriptor),
    [ATTR_BLAME_EXECUTION_STATUS]: outcome,
    [ATTR_BLAME_OPERATION_NAME]: operationName,
    ...(outcome === "failed"
      ? { [ATTR_ERROR_TYPE]: operationErrorType(error) }
      : {}),
  };
}

function recordOperationLog(
  span: BlameSpan,
  outcome: TelemetryOutcome,
  attributes: Record<string, unknown>,
  error?: unknown,
) {
  const telemetry = getBlameTelemetry();
  telemetry.log(
    outcome === "failed" ? "error" : "info",
    "blame.operation.completed",
    {
      ...attributes,
      ...(error ? errorAttributes(error) : {}),
    },
    span.context,
  );
}

function metricCohortAttributes(descriptor: ExecutionDescriptor | undefined) {
  const latest = descriptor
    ? getExecutionRegistry().attributes(descriptor.executionId)
    : undefined;
  return latest ?? descriptor?.attributes;
}

function operationSpanAttributes(
  descriptor: ExecutionDescriptor,
  operationName: string,
) {
  return {
    [ATTR_BLAME_EXECUTION_ID]: descriptor.executionId,
    [ATTR_BLAME_OPERATION_NAME]: operationName,
    [ATTR_BLAME_STORY_ID]: descriptor.storyId,
    [ATTR_BLAME_WORKTREE_ID]: descriptor.worktreeId,
  };
}

function operationErrorType(error: unknown) {
  if (error instanceof PreviewRuntimeError) return error.code;
  if (error instanceof Error && error.name) {
    return boundedMetricDimensionName(error.name);
  }
  return "Error";
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
  if (await stopPreviewStartWhenRequested(worktree)) return undefined;
  if (!(await projectRuntimeShouldStartBrowserPreview(worktree))) {
    await timedRecoveryStep(worktree, "preview probes", () =>
      runPreviewProbes(worktree),
    );
    return undefined;
  }
  return startSelectedWebPreview(worktree);
}

async function startSelectedWebPreview(worktree: string) {
  const previewUrl = await timedRecoveryStep(
    worktree,
    "preview url resolve",
    () => waitForPreviewUrl(worktree),
  );
  if (!previewUrl) return undefined;
  if (
    await timedRecoveryStep(worktree, "preview environment sync", () =>
      syncPreviewRuntimeEnvironment(worktree, previewUrl),
    )
  ) {
    await timedRecoveryStep(worktree, "preview service restart", () =>
      restartPreviewService(worktree, true),
    );
  }
  if (await stopPreviewStartWhenRequested(worktree)) return undefined;
  await timedRecoveryStep(worktree, "preview response wait", () =>
    waitForPreview(worktree, previewUrl),
  );
  if (await stopPreviewStartWhenRequested(worktree)) return undefined;
  await timedRecoveryStep(worktree, "preview probes", () =>
    runPreviewProbes(worktree),
  );
  return previewUrl;
}

async function projectRuntimeShouldStartBrowserPreview(worktree: string) {
  const [configurations, state, manifest] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
    readProjectPreviewManifest(worktree),
  ]);
  return shouldStartBrowserPreview(configurations, state, manifest);
}

async function syncPreviewRuntimeEnvironment(
  worktree: string,
  previewUrl: string,
) {
  const origin = previewOrigin(previewUrl);
  if (!origin) return false;
  const overrides = await projectPreviewEnvOverrides(worktree);
  if (await materializedPreviewEnvFilesMatch(worktree, origin, overrides)) {
    return false;
  }
  await materializedPreviewEnvHostFileMounts(worktree, origin, overrides);
  invalidateSetupEnvironment(worktree);
  return true;
}

async function projectPreviewEnvOverrides(worktree: string) {
  const composePath = projectComposePath(worktree);
  if (!(await runtimePathExists(composePath))) return [];
  return previewComposeEnvOverrides(await readRuntimeFile(composePath));
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
  const services = runtimeServices(
    config,
    new Set([...setupServices, ...completedServices]),
  );
  const selectedServices = await selectedComposeRuntimeServices(
    worktree,
    services,
  );
  if (!selectedServices.length) return;
  await timedRecoveryStep(worktree, "compose log stream", () =>
    startProjectLogStream(worktree),
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
        ...selectedServices,
      ],
      composeUpRetryDelaysMs,
      "compose start",
    ),
  );
}

async function selectedComposeRuntimeServices(
  worktree: string,
  runtimeServiceIds: string[],
) {
  const [configurations, state] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
  ]);
  return selectedPreviewRuntimeServiceIds(
    configurations,
    state,
    runtimeServiceIds,
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
    if (await previewRuntimeStopped(worktree)) return undefined;
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
  throw new PreviewRuntimeError(
    "preview_url_timeout",
    "Unable to resolve project preview URL",
  );
}

async function stopProjectSetup(input: StopProjectSetupInput) {
  const worktree = resolveRuntimePath(input.worktree);
  await stopSetupRunsForWorktree(worktree);
  if (input.workspaceMode === "cloud-mirror") return true;
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
  const mode = input.workspaceMode ?? "local-container";
  if (mode === "local-container")
    await ensureRuntimeGitSafeDirectory(repositoryRoot);
  await assertGitRepository(repositoryRoot);
  const registered = await worktreeRegistered(repositoryRoot, worktree, mode);
  if (!registered && !(await runtimePathExists(worktree))) return false;
  removingWorktrees.add(worktree);
  try {
    await stopSetupRunsForWorktree(worktree);
    await stopProjectLogStream(worktree);
    await releaseAgentWorkspaceSessions(worktree);
    previewRecoveries.delete(worktree);
    await cleanupCodeReviewGraphWorktree(worktree);
    if (!input.projectSetupStopped)
      await stopProjectSetup({ workspaceMode: mode, worktree });
    if (mode === "local-container") {
      const env = await setupEnvironment(worktree);
      await removeBlamePreviewProjectResources(env.COMPOSE_PROJECT_NAME);
    }
    if (registered) await removeGitWorktree(repositoryRoot, worktree, mode);
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
  const [configurations, runtimeState, manifest] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
    readProjectPreviewManifest(worktree),
  ]);
  if (runtimeState.desiredStatus === "stopped") return null;
  if (!shouldStartBrowserPreview(configurations, runtimeState, manifest)) {
    return null;
  }
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

async function ensureProjectPreviewUrl(input: EnsureProjectPreviewUrlInput) {
  if (input.workspaceMode === "cloud-mirror") return null;
  const worktree = resolveRuntimePath(input.worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  if (!(await isWorkspaceGitRepository(worktree))) return null;
  if (setupRunningForWorktree(worktree)) return null;
  const [configurations, runtimeState, manifest] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
    readProjectPreviewManifest(worktree),
  ]);
  if (runtimeState.desiredStatus === "stopped") return null;
  if (!shouldStartBrowserPreview(configurations, runtimeState, manifest)) {
    return null;
  }
  const currentUrl = await resolveProjectPreviewUrl({ worktree });
  if (currentUrl && (await previewResponds(currentUrl))) {
    const currentOrigin = previewOrigin(currentUrl);
    const envMatches = await materializedPreviewEnvFilesMatch(
      worktree,
      currentOrigin,
      await projectPreviewEnvOverrides(worktree),
    );
    if (envMatches && (await previewProbesPass(worktree))) return currentUrl;
  }
  if (!(await projectSetupCompleted(worktree))) return null;
  const recovery = previewRecoveries.get(worktree);
  if (recovery) return recovery;
  const nextRecovery = runPreviewRecovery(input, worktree, {
    reallocatePorts: Boolean(currentUrl),
  }).finally(() => {
    previewRecoveries.delete(worktree);
  });
  previewRecoveries.set(worktree, nextRecovery);
  return nextRecovery;
}

export async function projectPreviewRuntimeState(
  worktreeInput: string,
  workspaceMode: WorkspaceMode = "local-container",
): Promise<ProjectPreviewRuntimeState> {
  const worktree = resolveRuntimePath(worktreeInput);
  if (workspaceMode === "cloud-mirror") {
    return cloudMirrorPreviewRuntimeState(worktree);
  }
  const [configurations, runtimeState, containers, manifest] =
    await Promise.all([
      readProjectRunConfigurations(worktree),
      readPreviewRuntimeFileState(worktree),
      composeProjectContainers(worktree),
      readProjectPreviewManifest(worktree),
    ]);
  const selected = selectedPreviewRunConfiguration(
    configurations,
    runtimeState,
  );
  const runtimeContainers = containers.map(previewRuntimeContainerState);
  const statuses = previewConfigurationStatuses(
    configurations,
    runtimeContainers,
    runtimeState,
    manifest,
  );
  const previewUrl =
    runtimeState.desiredStatus === "running" && selected?.previewService
      ? ((await resolveProjectPreviewUrl({ worktree })) ?? undefined)
      : undefined;
  return {
    configurations,
    desiredStatus: runtimeState.desiredStatus,
    ...(previewUrl ? { previewUrl } : {}),
    ...(selected ? { selectedConfigurationId: selected.id } : {}),
    statuses,
  };
}

async function cloudMirrorPreviewRuntimeState(
  worktree: string,
): Promise<ProjectPreviewRuntimeState> {
  const [configurations, runtimeState] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
  ]);
  const selected = selectedPreviewRunConfiguration(
    configurations,
    runtimeState,
  );
  return {
    configurations,
    desiredStatus: "stopped",
    ...(selected ? { selectedConfigurationId: selected.id } : {}),
    statuses: Object.fromEntries(
      configurations.map(({ id }) => [id, "stopped"]),
    ),
  };
}

function previewConfigurationStatuses(
  configurations: ProjectRunConfiguration[],
  containers: ReturnType<typeof previewRuntimeContainerState>[],
  runtimeState: PreviewRuntimeSelectionState,
  manifest: PreviewManifest | undefined,
) {
  return Object.fromEntries(
    configurations.map((configuration) => [
      configuration.id,
      previewRunConfigurationStatus(
        previewStatusConfiguration(configuration, manifest),
        containers,
        runtimeState,
      ),
    ]),
  );
}

function previewStatusConfiguration(
  configuration: ProjectRunConfiguration,
  manifest: PreviewManifest | undefined,
) {
  if (!manifest) return configuration;
  return {
    ...configuration,
    services: previewRunConfigurationServiceIds(configuration, manifest),
  };
}

export async function controlProjectPreview(input: ControlProjectPreviewInput) {
  const selection = await previewControlSelection(input);
  await appendRecoveryLog(
    selection.worktree,
    `run configuration ${input.action}: ${selection.selected.id}`,
  );
  if (input.action === "stop") return stopProjectPreview(selection);
  return startProjectPreview(selection, input.action === "restart");
}

async function previewControlSelection(input: ControlProjectPreviewInput) {
  assertPreviewRunnerAction(input.action);
  const worktree = resolveRuntimePath(input.worktree);
  const configurations = await readProjectRunConfigurations(worktree);
  const state = await readPreviewRuntimeFileState(worktree);
  const current = selectedPreviewRunConfiguration(configurations, state);
  const selected = input.configurationId
    ? configurations.find(({ id }) => id === input.configurationId)
    : current;
  if (!selected) throw new Error("Preview run configuration not found");
  return { current, selected, worktree } satisfies PreviewControlSelection;
}

async function stopProjectPreview(selection: PreviewControlSelection) {
  const { current, selected, worktree } = selection;
  await writePreviewRuntimeState(worktree, {
    desiredStatus: "stopped",
    selectedConfigurationId: selected.id,
  });
  if (current && current.id !== selected.id) {
    await stopRunConfigurationServices(worktree, current);
  }
  await stopRunConfigurationServices(worktree, selected);
  return projectPreviewRuntimeState(worktree);
}

async function startProjectPreview(
  selection: PreviewControlSelection,
  restart: boolean,
) {
  const { current, selected, worktree } = selection;
  if (current && current.id !== selected.id) {
    await stopRunConfigurationServices(worktree, current);
  }
  await writePreviewRuntimeState(worktree, {
    desiredStatus: "running",
    selectedConfigurationId: selected.id,
  });
  if (restart) await stopRunConfigurationServices(worktree, selected);
  await stopInactiveRunConfigurationServices(worktree, selected);
  await startProjectCompose(worktree);
  return projectPreviewRuntimeState(worktree);
}

function assertPreviewRunnerAction(action: string) {
  if (action === "start" || action === "stop" || action === "restart") return;
  throw new Error("Preview runner action is invalid");
}

async function stopRunConfigurationServices(
  worktree: string,
  configuration: ProjectRunConfiguration,
) {
  const services = await runConfigurationServiceIds(worktree, configuration);
  await stopComposeServices(worktree, services);
}

async function stopInactiveRunConfigurationServices(
  worktree: string,
  configuration: ProjectRunConfiguration,
) {
  const config = await composeConfig(worktree, projectComposePath(worktree));
  const active = new Set(
    await runConfigurationServiceIds(worktree, configuration),
  );
  const inactive = composeRuntimeServices(config).filter(
    (service) => !active.has(service),
  );
  await stopComposeServices(worktree, inactive);
}

async function runConfigurationServiceIds(
  worktree: string,
  configuration: ProjectRunConfiguration,
) {
  const manifest = await readProjectPreviewManifest(worktree);
  return manifest
    ? previewRunConfigurationServiceIds(configuration, manifest)
    : composeRunConfigurationServiceIds(worktree, configuration);
}

async function stopComposeServices(worktree: string, services: string[]) {
  if (!services.length) return;
  await containerRuntime.compose(
    [
      ...composeArgs(worktree),
      "stop",
      "--timeout",
      String(previewStopTimeoutSeconds),
      ...services,
    ],
    { cwd: worktree, env: await setupEnvironment(worktree) },
  );
}

async function composeRunConfigurationServiceIds(
  worktree: string,
  configuration: ProjectRunConfiguration,
) {
  const config = await composeConfig(worktree, projectComposePath(worktree));
  const initial = configuration.services?.length
    ? configuration.services
    : composeRuntimeServices(config);
  const active = new Set(initial);
  const pending = Array.from(active);
  while (pending.length) {
    const service = config.services?.[pending.shift() ?? ""];
    for (const dependency of composeServiceDependencies(service)) {
      if (!config.services?.[dependency] || active.has(dependency)) continue;
      active.add(dependency);
      pending.push(dependency);
    }
  }
  return Array.from(active);
}

function composeRuntimeServices(config: ComposeConfig) {
  const completed = new Set([
    ...setupTaskServices(config),
    ...completedDependencyServices(config),
  ]);
  return runtimeServices(config, completed);
}

function composeServiceDependencies(service: ComposeService | undefined) {
  if (!service?.depends_on) return [];
  return Array.isArray(service.depends_on)
    ? service.depends_on
    : Object.keys(service.depends_on);
}

async function stopPreviewStartWhenRequested(worktree: string) {
  const state = await readPreviewRuntimeFileState(worktree);
  if (state.desiredStatus === "running") return false;
  const configurations = await readProjectRunConfigurations(worktree);
  const selected = selectedPreviewRunConfiguration(configurations, state);
  if (selected) await stopRunConfigurationServices(worktree, selected);
  return true;
}

async function previewRuntimeStopped(worktree: string) {
  return (
    (await readPreviewRuntimeFileState(worktree)).desiredStatus === "stopped"
  );
}

async function readProjectRunConfigurations(worktree: string) {
  const path = projectRunConfigurationsPath(worktree);
  if (!(await runtimePathExists(path))) return [];
  const configurations = parseRunConfigurations(
    JSON.parse(await readRuntimeFile(path)),
  );
  const manifest = await readProjectPreviewManifest(worktree);
  const normalized = normalizeStoredRunConfigurations(configurations, manifest);
  if (JSON.stringify(configurations) !== JSON.stringify(normalized)) {
    await writeRuntimeJson(path, normalized);
  }
  return normalized;
}

async function readPreviewRuntimeFileState(
  worktree: string,
): Promise<PreviewRuntimeSelectionState> {
  const path = projectPreviewRuntimeStatePath(worktree);
  if (!(await runtimePathExists(path))) return { desiredStatus: "running" };
  try {
    const parsed = JSON.parse(await readRuntimeFile(path)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { desiredStatus: "running" };
    }
    const record = parsed as Record<string, unknown>;
    return {
      desiredStatus: record.desiredStatus === "stopped" ? "stopped" : "running",
      ...(typeof record.selectedConfigurationId === "string"
        ? { selectedConfigurationId: record.selectedConfigurationId }
        : {}),
    };
  } catch {
    return { desiredStatus: "running" };
  }
}

function writePreviewRuntimeState(
  worktree: string,
  state: PreviewRuntimeSelectionState,
) {
  return writeRuntimeJson(projectPreviewRuntimeStatePath(worktree), state);
}

function runtimeContainerService(container: RuntimeContainer) {
  return container.Config?.Labels?.["com.docker.compose.service"] ?? "";
}

function previewRuntimeContainerState(container: RuntimeContainer) {
  return {
    exitCode: container.State?.ExitCode,
    health: container.State?.Health?.Status,
    service: runtimeContainerService(container),
    status: container.State?.Status,
  };
}

async function previewProbesPass(worktree: string) {
  try {
    await runPreviewProbes(worktree);
    return true;
  } catch (error) {
    await appendRecoveryLog(
      worktree,
      `preview functional check failed: ${operationErrorType(error)}`,
    );
    return false;
  }
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

async function runPreviewRecovery(
  input: EnsureProjectPreviewUrlInput,
  worktree: string,
  options: { reallocatePorts?: boolean },
) {
  const operation = beginExecutionOperation(
    input,
    previewStartOperationName,
    worktree,
  );
  void enrichExecutionRepositoryCohorts(operation, worktree);
  const action = () => recoverProjectPreview(worktree, options);
  return runExecutionOperation(operation, action, (result) =>
    result ? "succeeded" : "canceled",
  );
}

async function recoverProjectPreview(
  worktree: string,
  options: { reallocatePorts?: boolean } = {},
) {
  if (await previewRuntimeStopped(worktree)) return null;
  await runExistingProjectSetup(worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  if (await previewRuntimeStopped(worktree)) return null;
  await appendRecoveryLog(worktree, "compose starting");
  try {
    const previewUrl = await startProjectCompose(worktree, options);
    await appendRecoveryLog(
      worktree,
      previewUrl ? `preview ready at ${previewUrl}` : "run configuration ready",
    );
    return previewUrl ?? null;
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
  Array.from(setupRuns.values()).forEach((run) =>
    finishSetupRun(run, "canceled"),
  );
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
      finishSetupRun(run, "canceled");
      await stopChildProcess(run.process);
    }),
  );
}

async function listProjectServices(worktreeInput: string) {
  const worktree = resolveRuntimePath(worktreeInput);
  const composePath = projectComposePath(worktree);
  try {
    if (await runtimePathExists(composePath)) {
      return composeRuntimeServiceNames(await readRuntimeFile(composePath));
    }
  } catch {}
  return listProjectServicesWithCompose(worktree);
}

async function listProjectServicesWithCompose(worktree: string) {
  const config = await composeConfig(worktree, projectComposePath(worktree));
  return composeRuntimeServices(config).sort(serviceSort);
}

function composeRuntimeServiceNames(compose: string) {
  const parsed = parseYaml(compose) as unknown;
  if (!parsed || typeof parsed !== "object") return [];
  return composeRuntimeServices(parsed as ComposeConfig).sort(serviceSort);
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

export async function readProjectServiceLogs(input: {
  service?: string;
  tailLines?: number;
  worktree: string;
}) {
  const worktree = resolveRuntimePath(input.worktree);
  const services = await listProjectServices(worktree);
  const service = selectedProjectService(input.service, services);
  if (!service) {
    return {
      available: false,
      reason: input.service
        ? `Service "${input.service}" was not found.`
        : "No services found yet.",
      services,
    };
  }
  return {
    available: true,
    service,
    services,
    ...(await projectServiceLogSnapshot(worktree, service, input.tailLines)),
  };
}

async function projectServiceLogSnapshot(
  worktree: string,
  service: string,
  tailLines?: number,
) {
  const lineCount = serviceLogTailLines(tailLines);
  try {
    const { stdout, stderr } = await containerRuntime.compose(
      [...composeArgs(worktree), "logs", "--tail", String(lineCount), service],
      {
        cwd: worktree,
        env: await setupEnvironment(worktree),
        timeoutMs: containerMetadataTimeoutMs,
      },
    );
    if (stdout || stderr) return { source: "container", stderr, stdout };
  } catch (error) {
    return projectServiceLogFallback(worktree, service, error);
  }
  return projectServiceLogFallback(worktree, service);
}

async function projectServiceLogFallback(
  worktree: string,
  service: string,
  error?: unknown,
) {
  const archived = await archivedProjectServiceLog(worktree, service);
  if (archived) return { source: "setup-log", stderr: "", stdout: archived };
  return {
    source: "container",
    stderr: error ? commandErrorText(error).trim() : "",
    stdout: "",
  };
}

function selectedProjectService(
  service: string | undefined,
  services: string[],
) {
  if (!service) return services[0];
  return services.includes(service) ? service : undefined;
}

function serviceLogTailLines(value: number | undefined) {
  if (!Number.isFinite(value)) return 120;
  return Math.min(Math.max(Math.trunc(value ?? 120), 1), 1000);
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
    return await traceWorkspaceStep(label, action);
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

async function removeGitWorktree(
  repositoryRoot: string,
  worktree: string,
  mode: WorkspaceMode,
) {
  if (mode === "local-container")
    await ensureRuntimeGitSafeDirectory(repositoryRoot);
  try {
    await runRuntimeGit(
      repositoryRoot,
      ["worktree", "remove", "--force", worktree],
      workspaceExecution(mode),
    );
  } catch (error) {
    if (isPermissionDeniedError(error)) {
      await removeStaleGitWorktree(repositoryRoot, worktree, mode);
      return;
    }
    if (!isDirectoryNotEmptyError(error)) throw error;
    if (await worktreeRegistered(repositoryRoot, worktree, mode)) throw error;
  }

  await rmRuntime(worktree);
}

async function removeStaleGitWorktree(
  repositoryRoot: string,
  worktree: string,
  mode: WorkspaceMode,
) {
  await rmRuntime(worktree);
  await runRuntimeGit(
    repositoryRoot,
    ["worktree", "prune"],
    workspaceExecution(mode),
  );
  if (await worktreeRegistered(repositoryRoot, worktree, mode))
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
  const hostEnvironment = withoutTelemetryEnvironment(process.env);
  const environment = {
    ...containerRuntimeEnvironment(hostEnvironment),
    ...(await worktreeRuntimeEnvironment(worktree)),
    ...hostEnvironment,
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
  return withoutTelemetryEnvironment(environment) as SetupEnvironment;
}

function invalidateSetupEnvironment(worktree: string) {
  setupEnvironmentCache.delete(worktree);
}

function runtimeManagerEnvironment() {
  return {
    ...withoutTelemetryEnvironment(process.env),
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

function projectPreviewManifestPath(worktree: string) {
  return joinWorkspacePath(
    worktree,
    ".blame",
    "initialization",
    "preview-manifest.json",
  );
}

function projectRunConfigurationsPath(worktree: string) {
  return joinWorkspacePath(
    worktree,
    ".blame",
    "initialization",
    "run-configurations.json",
  );
}

function projectPreviewRuntimeStatePath(worktree: string) {
  return joinWorkspacePath(
    worktree,
    ".blame",
    "initialization",
    "preview-runtime-state.json",
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
  const selectedService = await selectedPreviewServiceId(worktree);
  const labeledTarget = services
    .map(([service, config]) => labeledPreviewTarget(service, config))
    .sort((left, right) =>
      previewTargetSelectionOrder(left, right, selectedService),
    )
    .find(Boolean);
  if (labeledTarget) return labeledTarget;
  return services
    .map(([service, config]) => exposedPreviewTarget(service, config))
    .find(Boolean);
}

async function selectedPreviewServiceId(worktree: string) {
  const [configurations, state] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
  ]);
  return selectedPreviewRunConfiguration(configurations, state)?.previewService;
}

function previewTargetSelectionOrder(
  left: ReturnType<typeof labeledPreviewTarget>,
  right: ReturnType<typeof labeledPreviewTarget>,
  selectedService: string | undefined,
) {
  if (left?.service === selectedService) return -1;
  if (right?.service === selectedService) return 1;
  return 0;
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
  await sanitizeWorkspaceConfigFiles(worktree);
  await repairComposeFile(worktree, projectComposePath(worktree), options);
}

async function repairComposeFile(
  worktree: string,
  composePath: string,
  options: { reallocatePorts?: boolean } = {},
) {
  if (!(await runtimePathExists(composePath))) return;
  const compose = await readRuntimeFile(composePath);
  const nextCompose = (await worktreeHasNextProject(worktree))
    ? commandWithNextWebpackFallback(compose)
    : compose;
  const allocatedCompose = await composeWithAllocatedHostPorts(
    composeWithNonMutatingNpmInstalls(
      composeWithoutNumericSuUser(
        composeWithRuntimePortPlaceholders(
          dockerComposeWithPortableWindowsPaths(nextCompose),
          options.reallocatePorts,
        ),
      ),
    ),
  );
  validatePreviewComposeBindings(allocatedCompose);
  const overrides = previewComposeEnvOverrides(allocatedCompose);
  await logPreviewEnvOverrides(worktree, overrides);
  const envMounts = await materializedPreviewEnvHostFileMounts(
    worktree,
    composePreviewOrigin(allocatedCompose),
    overrides,
  );
  const repairedCompose = dockerComposeWithHostFileMounts(
    allocatedCompose,
    worktree,
    envMounts,
  );
  if (repairedCompose !== compose)
    await writeRuntimeFile(composePath, repairedCompose);
}

async function worktreeHasNextProject(worktree: string) {
  const manifest = await readProjectPreviewManifest(worktree).catch(
    () => undefined,
  );
  const detectedStackResult = detectedStackUsesNext(manifest);
  if (detectedStackResult !== undefined) return detectedStackResult;
  const paths = await findProjectFilesByName(worktree, "package.json");
  return projectPackageFilesUseNext(paths);
}

async function projectPackageFilesUseNext(paths: string[]) {
  const batchSize = 64;
  for (let index = 0; index < paths.length; index += batchSize) {
    const files = await readExistingRuntimeFiles(
      paths.slice(index, index + batchSize),
    );
    if (Object.values(files).some(packageJsonUsesNext)) return true;
  }
  return false;
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
  await timedRecoveryStep(worktree, "compose binding validation", () =>
    validatePreviewComposeBindings(allocatedCompose),
  );
  const overrides = previewComposeEnvOverrides(allocatedCompose);
  await logPreviewEnvOverrides(worktree, overrides);
  const envMounts = await timedRecoveryStep(
    worktree,
    "preview env host mounts",
    () =>
      materializedPreviewEnvHostFileMounts(
        worktree,
        composePreviewOrigin(allocatedCompose),
        overrides,
      ),
  );
  return timedRecoveryStep(worktree, "compose inject host mounts", () =>
    dockerComposeWithHostFileMounts(allocatedCompose, worktree, [
      ...symlinkEnvMounts,
      ...envMounts,
    ]),
  );
}

async function logPreviewEnvOverrides(
  worktree: string,
  overrides: Array<{
    localHosts?: Record<string, string>;
    values: Record<string, string>;
  }>,
) {
  const bindings = overrides.reduce(
    (count, override) => count + Object.keys(override.values).length,
    0,
  );
  const inferredHosts = overrides.reduce(
    (count, override) =>
      count + Object.values(override.localHosts ?? {}).filter(Boolean).length,
    0,
  );
  if (bindings + inferredHosts === 0) return;
  await appendRecoveryLog(
    worktree,
    `preview env overrides prepared: ${bindings} bindings, ${inferredHosts} inferred hosts`,
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
      {
        cwd: worktree,
        env: await setupEnvironment(worktree),
        timeoutMs: containerMetadataTimeoutMs,
      },
    );
    if (stdout) await appendRecoveryLog(worktree, stdout.trimEnd());
    if (stderr) await appendRecoveryLog(worktree, stderr.trimEnd());
  } catch (error) {
    await appendRecoveryLog(worktree, commandErrorText(error).trim());
  }
}

async function labeledContainerPreviewUrl(worktree: string) {
  const containers = await previewContainers(false, worktree);
  const selectedService = await selectedPreviewServiceId(worktree);
  const matching = containers.filter((container) =>
    containerMatchesWorktree(container, worktree),
  );
  const container =
    matching.find(
      (candidate) => runtimeContainerService(candidate) === selectedService,
    ) ?? matching[0];
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
      {
        cwd: worktree,
        env: await setupEnvironment(worktree),
        timeoutMs: containerMetadataTimeoutMs,
      },
    );
    const ids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (ids.length === 0) return [];
    return containerRuntime.inspect<RuntimeContainer>(ids, {
      timeoutMs: containerMetadataTimeoutMs,
    });
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
  const startedAt = Date.now();
  const deadline = startedAt + previewResponseTimeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    if (await previewRuntimeStopped(worktree)) return;
    attempts += 1;
    if (await previewResponds(url)) {
      await appendRecoveryLog(
        worktree,
        `preview responded after ${attempts} attempt${attempts === 1 ? "" : "s"}`,
      );
      return;
    }
    await assertPreviewContainerCanStillStart(worktree, startedAt);
    await delay(previewStartupIntervalMs);
  }
  await appendComposeDiagnostics(worktree);
  throw new PreviewRuntimeError(
    "preview_response_timeout",
    `Preview did not respond within ${previewResponseTimeoutMs / 1_000} seconds`,
  );
}

async function runPreviewProbes(worktree: string) {
  const manifest = await readProjectPreviewManifest(worktree);
  if (!manifest?.probes?.length) return;
  const activeServices = await activeRunConfigurationServices(
    worktree,
    manifest,
  );
  const probes = manifest.probes.filter((probe) =>
    activePreviewProbe(probe, activeServices),
  );
  let passed = 0;
  for (const probe of probes) {
    try {
      await executePreviewProbe(worktree, manifest, probe);
      passed += 1;
    } catch (error) {
      await appendRecoveryLog(worktree, `preview probe ${probe.id} failed`);
      if (probe.required !== false) throw previewProbeError(error, probe.id);
    }
  }
  await appendRecoveryLog(
    worktree,
    `preview probes passed: ${passed}/${probes.length}`,
  );
}

async function activeRunConfigurationServices(
  worktree: string,
  manifest: PreviewManifest,
) {
  const [configurations, state] = await Promise.all([
    readProjectRunConfigurations(worktree),
    readPreviewRuntimeFileState(worktree),
  ]);
  if (!configurations.length) return undefined;
  const selected = selectedPreviewRunConfiguration(configurations, state);
  return selected
    ? new Set(previewRunConfigurationServiceIds(selected, manifest))
    : new Set<string>();
}

function activePreviewProbe(
  probe: PreviewManifestProbe,
  activeServices: Set<string> | undefined,
) {
  if (!activeServices) return true;
  return (
    activeServices.has(probe.target.service) &&
    (probe.from === "host" || activeServices.has(probe.from))
  );
}

async function readProjectPreviewManifest(worktree: string) {
  const path = projectPreviewManifestPath(worktree);
  if (!(await runtimePathExists(path))) return undefined;
  try {
    return parsePreviewManifest(JSON.parse(await readRuntimeFile(path)));
  } catch (error) {
    throw new PreviewRuntimeError(
      "preview_manifest_invalid",
      `Persisted preview manifest is invalid: ${errorMessageText(error)}`,
    );
  }
}

async function executePreviewProbe(
  worktree: string,
  manifest: PreviewManifest,
  probe: PreviewManifestProbe,
) {
  const endpoint = manifestProbeEndpoint(manifest, probe);
  if (probe.from === "host") {
    await executeHostPreviewProbe(worktree, probe, endpoint);
    return;
  }
  await executeServicePreviewProbe(worktree, manifest, probe, endpoint);
}

function manifestProbeEndpoint(
  manifest: PreviewManifest,
  probe: PreviewManifestProbe,
) {
  const service = manifest.services.find(
    ({ id }) => id === probe.target.service,
  );
  const endpoint =
    service && manifestServiceEndpoint(service, probe.target.endpoint);
  if (!endpoint) {
    throw new PreviewRuntimeError(
      "preview_manifest_invalid",
      `Preview probe ${probe.id} references an unknown endpoint`,
    );
  }
  return endpoint;
}

function manifestServiceEndpoint(
  service: PreviewManifestService,
  endpointId: string,
): PreviewManifestEndpoint | undefined {
  return service.endpoints.find(({ id }) => id === endpointId);
}

async function executeHostPreviewProbe(
  worktree: string,
  probe: PreviewManifestProbe,
  endpoint: PreviewManifestEndpoint,
) {
  const address = await composePublishedAddress(
    worktree,
    projectComposePath(worktree),
    probe.target.service,
    endpoint.port,
  );
  if (!address) throw new Error("Probe target is not published to the host");
  if (probe.type === "tcp") {
    await connectToProbeAddress(address, probe.timeoutMs ?? 10_000);
    return;
  }
  const url = previewUrl(
    address,
    endpoint.protocol,
    probe.target.path ?? endpoint.healthcheck?.path ?? "/",
  );
  await requestProbeUrl(url, probe);
}

async function requestProbeUrl(url: string, probe: PreviewManifestProbe) {
  const response = await fetch(url, {
    method: "GET",
    signal: AbortSignal.timeout(probe.timeoutMs ?? 10_000),
  });
  if (probeAcceptsStatus(probe, response.status)) return;
  throw new Error(`Unexpected probe status ${response.status}`);
}

function probeAcceptsStatus(probe: PreviewManifestProbe, status: number) {
  return probe.acceptedStatuses?.length
    ? probe.acceptedStatuses.includes(status)
    : status < 500;
}

function connectToProbeAddress(address: string, timeoutMs: number) {
  const url = new URL(previewUrl(address, "http", "/"));
  return new Promise<void>((resolve, reject) => {
    const socket = createConnection(Number(url.port), url.hostname);
    const timeout = setTimeout(
      () => socket.destroy(new Error("Probe timed out")),
      timeoutMs,
    );
    socket.once("connect", () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function executeServicePreviewProbe(
  worktree: string,
  manifest: PreviewManifest,
  probe: PreviewManifestProbe,
  endpoint: PreviewManifestEndpoint,
) {
  const consumer = manifest.services.find(({ id }) => id === probe.from);
  const command = consumer && serviceProbeCommand(consumer, probe, endpoint);
  if (!command) {
    throw new PreviewRuntimeError(
      "preview_probe_unsupported",
      `Preview probe ${probe.id} has no supported runtime`,
    );
  }
  await containerRuntime.compose(
    [...composeArgs(worktree), "exec", "-T", probe.from, ...command],
    { cwd: worktree, env: await setupEnvironment(worktree) },
  );
}

function serviceProbeCommand(
  service: PreviewManifestService,
  probe: PreviewManifestProbe,
  endpoint: PreviewManifestEndpoint,
) {
  const javascriptRuntime = serviceJavascriptRuntime(service);
  if (javascriptRuntime) {
    return [javascriptRuntime, "-e", nodeProbeScript(probe, endpoint)];
  }
  if (serviceUsesPython(service)) {
    return ["python", "-c", pythonProbeScript(probe, endpoint)];
  }
  return undefined;
}

function serviceJavascriptRuntime(service: PreviewManifestService) {
  const image = service.container.image ?? "";
  if (
    /(?:^|\/)bun(?::|$)/.test(image) ||
    /\bbun\b/.test(service.command ?? "")
  ) {
    return "bun";
  }
  if (
    /(?:^|\/)node(?::|$)/.test(image) ||
    /\b(?:node|npm|pnpm|yarn)\b/.test(service.command ?? "")
  ) {
    return "node";
  }
  return undefined;
}

function serviceUsesPython(service: PreviewManifestService) {
  const image = service.container.image ?? "";
  return (
    /(?:^|\/)python(?::|$)/.test(image) ||
    /\bpython\b/.test(service.command ?? "")
  );
}

function nodeProbeScript(
  probe: PreviewManifestProbe,
  endpoint: PreviewManifestEndpoint,
) {
  const timeout = probe.timeoutMs ?? 10_000;
  if (probe.type === "tcp") {
    return nodeTcpProbeScript(probe.target.service, endpoint.port, timeout);
  }
  const url = internalProbeUrl(probe, endpoint);
  const accepted = JSON.stringify(probe.acceptedStatuses ?? []);
  return `const a=${accepted};fetch(${JSON.stringify(url)},{signal:AbortSignal.timeout(${timeout})}).then(r=>process.exit((a.length?a.includes(r.status):r.status<500)?0:1)).catch(()=>process.exit(1))`;
}

function nodeTcpProbeScript(host: string, port: number, timeout: number) {
  return `const s=require("net").connect(${port},${JSON.stringify(host)},()=>process.exit(0));s.once("error",()=>process.exit(1));s.setTimeout(${timeout},()=>process.exit(1))`;
}

function pythonProbeScript(
  probe: PreviewManifestProbe,
  endpoint: PreviewManifestEndpoint,
) {
  const timeout = Math.ceil((probe.timeoutMs ?? 10_000) / 1_000);
  if (probe.type === "tcp") {
    return `import socket\nsocket.create_connection((${JSON.stringify(probe.target.service)},${endpoint.port}),${timeout}).close()`;
  }
  const accepted = JSON.stringify(probe.acceptedStatuses ?? []);
  return [
    "import sys,urllib.request,urllib.error",
    `accepted=${accepted}`,
    `url=${JSON.stringify(internalProbeUrl(probe, endpoint))}`,
    `timeout=${timeout}`,
    "try:\n status=urllib.request.urlopen(url,timeout=timeout).status\nexcept urllib.error.HTTPError as error:\n status=error.code",
    "sys.exit(0 if (status in accepted if accepted else status < 500) else 1)",
  ].join("\n");
}

function internalProbeUrl(
  probe: PreviewManifestProbe,
  endpoint: PreviewManifestEndpoint,
) {
  const path = probe.target.path ?? endpoint.healthcheck?.path ?? "/";
  return `${endpoint.protocol}://${probe.target.service}:${endpoint.port}${path}`;
}

function previewProbeError(error: unknown, probeId: string) {
  if (error instanceof PreviewRuntimeError) return error;
  return new PreviewRuntimeError(
    "preview_probe_failed",
    `Required preview probe ${probeId} failed: ${errorMessageText(error)}`,
  );
}

async function assertPreviewContainerCanStillStart(
  worktree: string,
  startedAt: number,
) {
  const container = await previewContainerForWorktree(worktree);
  const status = container?.State?.Status;
  const health = container?.State?.Health?.Status;
  const failure = previewContainerFailure({
    discoveryGraceMs: previewDiscoveryGraceMs,
    elapsedMs: Date.now() - startedAt,
    found: Boolean(container),
    health,
    status,
  });
  if (!failure) return;
  await appendComposeDiagnostics(worktree);
  const state = health || status || "missing";
  throw new PreviewRuntimeError(
    failure,
    `Preview container cannot become ready (${state})`,
  );
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
      {
        cwd: worktree,
        env: await setupEnvironment(worktree),
        timeoutMs: containerMetadataTimeoutMs,
      },
    );
    const ids = composePsContainerIds(stdout);
    if (ids.length === 0) return [];
    return containerRuntime.inspect<RuntimeContainer>(ids, {
      timeoutMs: containerMetadataTimeoutMs,
    });
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
  const selectedService = await selectedPreviewServiceId(worktree);
  const labeled = containers.find(
    (container) =>
      containerMatchesWorktree(container, worktree) &&
      (!selectedService ||
        runtimeContainerService(container) === selectedService),
  );
  if (labeled) return labeled;
  const projectContainers = await composeProjectContainers(worktree);
  return projectContainers.find(
    (container) =>
      !completedSetupContainer(container) &&
      containerMatchesWorktree(container, worktree) &&
      (!selectedService ||
        runtimeContainerService(container) === selectedService),
  );
}

function failedContainerStatus(status: string | undefined) {
  return status === "dead" || status === "exited" || status === "removing";
}

async function previewResponds(url: string) {
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(previewRequestTimeoutMs),
    });
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
  if (error instanceof PreviewRuntimeError)
    return `[${error.code}] ${error.message}\n`;
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
