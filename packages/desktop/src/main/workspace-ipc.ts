import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  appendFile,
  chmod,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { promisify } from "node:util";
import { BrowserWindow, ipcMain } from "electron";
import { generateNewProjectWithAgent } from "./agent-ipc";
import {
  assertHostDependencies,
  checkHostDependencies,
} from "./host-dependencies";
import { setupPath } from "./host-tool-path";
import {
  createProject,
  setNewProjectAgentRuntime,
  setProjectCreationWindowsProvider,
  type CreateProjectInput,
} from "./project-creation";
import { setupShellCommand } from "./setup-shell";
import {
  dockerComposeForPreview,
  dockerComposeWithPortableWindowsPaths,
} from "./workspace-compose";
import { copyProjectEnvFiles } from "./workspace-env";

const execFileAsync = promisify(execFile);
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

type RemoveWorktreeInput = {
  repositoryRoot: string;
  worktree: string;
};

type ResolveProjectPreviewUrlInput = {
  worktree: string;
};

type ComposeService = {
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

type DockerContainer = {
  Config?: {
    Labels?: Record<string, string>;
  };
  NetworkSettings?: {
    Ports?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null
    >;
  };
  State?: {
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

const setupRuns = new Map<string, SetupRun>();
const previewRecoveries = new Map<string, Promise<string | null>>();
const removingWorktrees = new Set<string>();
const removedWorktrees = new Set<string>();
const workspaceProcesses = new Set<ChildProcessWithoutNullStreams>();

export function registerWorkspaceIpcHandlers() {
  setProjectCreationWindowsProvider(() => BrowserWindow.getAllWindows());
  setNewProjectAgentRuntime({ generate: generateNewProjectWithAgent });
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
    "workspace:git-repository-fingerprint",
    (_event, input: { root: string }) => gitRepositoryFingerprint(input.root),
  );
  ipcMain.handle(
    "workspace:ensure-git-repository",
    (_event, input: { root: string }) => ensureGitRepository(input.root),
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
    "workspace:check-host-dependencies",
    (_event, input: CheckHostDependenciesInput) =>
      checkHostDependencies({
        env: setupEnvironment(input.worktree ? resolve(input.worktree) : ""),
        setupScript: input.setupScript,
      }),
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
}

async function listDirectory(input: WorkspacePathInput) {
  const directory = resolveWorkspacePath(input);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => ({
      name: entry.name,
      path: toWorkspacePath(input.root, resolve(directory, entry.name)),
      type: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) =>
      `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
    );
}

async function readWorkspaceFile(input: WorkspacePathInput) {
  const filePath = resolveWorkspacePath(input);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Path is not a file");
  return readFile(filePath, "utf8");
}

async function searchFiles(input: WorkspaceSearchInput) {
  const root = resolve(input.root);
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.min(input.limit ?? 30, 100);
  const matches: Array<{ name: string; path: string; type: "file" }> = [];
  await walk(root, root, query, limit, matches);
  return matches;
}

async function gitDiff(root: string) {
  const cwd = resolve(root);
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--no-ext-diff", "--"],
    { cwd },
  );
  return stdout;
}

async function gitRepositoryFingerprint(root: string) {
  const cwd = resolve(root);
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

async function ensureGitRepository(root: string) {
  const cwd = resolve(root);
  let changed = false;

  if (!(await isGitRepository(cwd))) {
    await execFileAsync("git", ["init"], { cwd });
    changed = true;
  }

  if (!(await hasGitHead(cwd))) {
    await createInitialGitCommit(cwd);
    changed = true;
  }

  return changed;
}

async function createWorktree(input: CreateWorktreeInput) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const repositoryName = basename(repositoryRoot);
  const slug = storySlug(input.storyId, input.title);
  const branch = `blame/story-${input.storyId}-${slug}`;
  const worktree = resolve(
    dirname(repositoryRoot),
    ".blame-worktrees",
    repositoryName,
    `story-${input.storyId}-${slug}`,
  );

  await ensureGitRepository(repositoryRoot);
  await mkdir(dirname(worktree), { recursive: true });

  if (await worktreeRegistered(repositoryRoot, worktree)) {
    await copyProjectEnvFiles(repositoryRoot, worktree);
    removedWorktrees.delete(worktree);
    return { worktree, branch };
  }

  if (existsSync(worktree)) {
    throw new Error("Worktree directory already exists but is not registered");
  }

  if (await branchExists(repositoryRoot, branch)) {
    await execFileAsync("git", ["worktree", "add", worktree, branch], {
      cwd: repositoryRoot,
    });
    await copyProjectEnvFiles(repositoryRoot, worktree);
    removedWorktrees.delete(worktree);
    return { worktree, branch };
  }

  await execFileAsync(
    "git",
    ["worktree", "add", "-b", branch, worktree, "HEAD"],
    {
      cwd: repositoryRoot,
    },
  );
  await copyProjectEnvFiles(repositoryRoot, worktree);
  removedWorktrees.delete(worktree);
  return { worktree, branch };
}

async function runProjectSetup(input: RunProjectSetupInput) {
  const worktree = resolve(input.worktree);
  const env = setupEnvironment(worktree);
  await assertHostDependencies({ env, setupScript: input.setupScript });
  await assertGitRepository(worktree);
  const directory = join(worktree, ".blame", "initialization");
  const scriptPath = join(directory, "setup.sh");
  const composePath = join(directory, "docker-compose.yml");
  const logPath = setupLogPath(worktree);

  await mkdir(directory, { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(scriptPath, input.setupScript, "utf8");
  await writeFile(logPath, "", "utf8");
  await writeFile(
    composePath,
    dockerComposeForPreview(input.dockerCompose, worktree),
    "utf8",
  );
  await chmod(scriptPath, 0o755);

  const runId = randomUUID();
  const shell = setupShellCommand(scriptPath, { env });
  const child = spawn(shell.command, shell.args, {
    cwd: worktree,
    detached: process.platform !== "win32",
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
    setupRuns.delete(runId);
    emitSetupOutput(
      runId,
      worktree,
      "stdout",
      "Project preview containers are running.\n",
    );
    emitSetupOutput(runId, worktree, "exit", "0");
  } catch (error) {
    setupRuns.delete(runId);
    emitSetupOutput(runId, worktree, "stderr", errorMessage(error));
    emitSetupOutput(runId, worktree, "exit", "1");
  }
}

async function startProjectCompose(worktree: string) {
  await repairProjectCompose(worktree);
  await runDockerComposeUp(worktree);
  const previewUrl = await waitForPreviewUrl(worktree);
  await waitForPreview(worktree, previewUrl);
  return previewUrl;
}

async function runDockerComposeUp(worktree: string) {
  const composeArgs = dockerComposeArgs(worktree);
  await runDockerComposeWithRetry(
    worktree,
    [...composeArgs, "pull"],
    composePullRetryDelaysMs,
    "compose image pull",
  );
  await runDockerComposeWithRetry(
    worktree,
    [...composeArgs, "up", "-d", "--remove-orphans"],
    composeUpRetryDelaysMs,
    "compose start",
  );
}

function dockerComposeArgs(worktree: string) {
  return [
    "compose",
    "-f",
    projectComposePath(worktree),
    "--project-directory",
    worktree,
  ];
}

async function runDockerComposeWithRetry(
  worktree: string,
  args: string[],
  retryDelays: number[],
  label: string,
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await execFileAsync("docker", args, {
        cwd: worktree,
        env: setupEnvironment(worktree),
      });
      return;
    } catch (error) {
      const retryDelay = retryDelays[attempt];
      if (!retryDelay || !transientDockerPullError(error)) throw error;
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
  const worktree = resolve(input.worktree);
  const composePath = join(
    worktree,
    ".blame",
    "initialization",
    "docker-compose.yml",
  );
  if (!existsSync(composePath)) return false;
  await repairComposeFile(composePath);
  try {
    await execFileAsync(
      "docker",
      [
        "compose",
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
  const repositoryRoot = resolve(input.repositoryRoot);
  const worktree = resolve(input.worktree);
  await assertGitRepository(repositoryRoot);
  const registered = await worktreeRegistered(repositoryRoot, worktree);
  if (!registered && !existsSync(worktree)) return false;
  removingWorktrees.add(worktree);
  try {
    await stopSetupRunsForWorktree(worktree);
    previewRecoveries.delete(worktree);
    if (registered) await removeGitWorktree(repositoryRoot, worktree);
    else await rm(worktree, { recursive: true, force: true });
    removedWorktrees.add(worktree);
    return true;
  } finally {
    removingWorktrees.delete(worktree);
  }
}

async function resolveProjectPreviewUrl(input: ResolveProjectPreviewUrlInput) {
  const worktree = resolve(input.worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (!(await isGitRepository(worktree))) return null;
  const composePath = projectComposePath(worktree);
  if (!existsSync(composePath)) return labeledContainerPreviewUrl(worktree);
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
  const worktree = resolve(input.worktree);
  if (removedWorktrees.has(worktree)) return null;
  if (removingWorktrees.has(worktree)) return null;
  if (!(await isGitRepository(worktree))) return null;
  if (setupRunningForWorktree(worktree)) return null;
  const currentUrl = await resolveProjectPreviewUrl({ worktree });
  if (currentUrl && (await previewResponds(currentUrl))) return currentUrl;
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
    await appendRecoveryLog(worktree, errorMessage(error).trim());
    throw error;
  }
}

async function runExistingProjectSetup(worktree: string) {
  const scriptPath = join(worktree, ".blame", "initialization", "setup.sh");
  if (!existsSync(scriptPath)) return;
  await appendRecoveryLog(worktree, "setup starting");
  await new Promise<void>((resolve, reject) => {
    const env = setupEnvironment(worktree);
    const shell = setupShellCommand(scriptPath, { env });
    const child = spawn(shell.command, shell.args, {
      cwd: worktree,
      detached: process.platform !== "win32",
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
  workspaceProcesses.clear();
  await Promise.all(activeProcesses.map(stopChildProcess));
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
  void appendFile(setupLogPath(worktree), data, "utf8");
}

async function appendRecoveryLog(worktree: string, message: string) {
  await mkdir(dirname(setupLogPath(worktree)), { recursive: true });
  await appendFile(setupLogPath(worktree), `\n[recovery ${message}]\n`, "utf8");
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
  const root = resolve(input.root);
  const target = resolve(root, input.path ?? ".");
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error("Path escapes workspace");
  return target;
}

function toWorkspacePath(root: string, target: string) {
  const path = relative(resolve(root), target);
  return path || ".";
}

function shouldSkip(name: string) {
  return [".git", "node_modules", "dist", "build", ".turbo"].includes(name);
}

async function gitRemoteUrls(cwd: string) {
  try {
    const { stdout } = await execFileAsync(
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
  await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
}

async function isGitRepository(cwd: string) {
  try {
    await assertGitRepository(cwd);
    return true;
  } catch {
    return false;
  }
}

async function hasGitHead(cwd: string) {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function createInitialGitCommit(cwd: string) {
  await execFileAsync("git", ["add", "-A", "--", "."], { cwd });
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Blame",
      "-c",
      "user.email=blame@local",
      "commit",
      "--allow-empty",
      "--no-gpg-sign",
      "--no-verify",
      "-m",
      "chore: initialize repository",
    ],
    { cwd },
  );
}

async function removeGitWorktree(repositoryRoot: string, worktree: string) {
  try {
    await execFileAsync("git", ["worktree", "remove", "--force", worktree], {
      cwd: repositoryRoot,
    });
  } catch (error) {
    if (!isDirectoryNotEmptyError(error)) throw error;
    if (await worktreeRegistered(repositoryRoot, worktree)) throw error;
  }

  await rm(worktree, { recursive: true, force: true });
}

function isDirectoryNotEmptyError(error: unknown) {
  return commandText(error, "stderr").includes("Directory not empty");
}

function transientDockerPullError(error: unknown) {
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
    await execFileAsync(
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
  const { stdout } = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd },
  );
  return stdout
    .split("\n")
    .some((line) => worktreeLineMatches(line, worktree));
}

function worktreeLineMatches(line: string, worktree: string) {
  if (!line.startsWith("worktree ")) return false;
  return normalizedPath(line.slice("worktree ".length).trim()) === normalizedPath(worktree);
}

function normalizedPath(path: string) {
  return resolve(path.replace(/\\/g, "/")).replace(/\\/g, "/").toLowerCase();
}

function storySlug(storyId: number, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `story-${storyId}`;
}

function setupEnvironment(worktree: string) {
  return {
    ...worktreeRuntimeEnvironment(worktree),
    ...process.env,
    BLAME_HOST_GID: hostGroupId(),
    BLAME_HOST_UID: hostUserId(),
    CI: "true",
    BLAME_DOCKER_COMPOSE_FILE: projectComposePath(worktree),
    BLAME_INITIALIZATION_DIR: join(worktree, ".blame", "initialization"),
    COMPOSE_PROJECT_NAME: `blame_${createHash("sha1")
      .update(worktree)
      .digest("hex")
      .slice(0, 12)}`,
    npm_config_yes: "true",
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
    ".blame-worktrees",
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
  return join(worktree, ".blame", "initialization", "docker-compose.yml");
}

function setupLogPath(worktree: string) {
  return join(worktree, ".blame", "logs", "setup.log");
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
  const { stdout } = await execFileAsync(
    "docker",
    [
      "compose",
      "-f",
      composePath,
      "--project-directory",
      worktree,
      "config",
      "--format",
      "json",
    ],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  const parsed = JSON.parse(stdout) as unknown;
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
    const { stdout } = await execFileAsync(
      "docker",
      [
        "compose",
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
  if (!existsSync(composePath)) return;
  const compose = await readFile(composePath, "utf8");
  const repairedCompose = dockerComposeWithPortableWindowsPaths(compose);
  if (repairedCompose !== compose) await writeFile(composePath, repairedCompose, "utf8");
}

async function appendComposeDiagnostics(worktree: string) {
  await appendRecoveryLog(worktree, "compose diagnostics");
  await appendDockerComposeOutput(worktree, ["ps", "-a"]);
  await appendDockerComposeOutput(worktree, ["logs", "--tail", "120", "app"]);
}

async function appendDockerComposeOutput(worktree: string, args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      [...dockerComposeArgs(worktree), ...args],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    if (stdout) await appendRecoveryLog(worktree, stdout.trimEnd());
    if (stderr) await appendRecoveryLog(worktree, stderr.trimEnd());
  } catch (error) {
    await appendRecoveryLog(worktree, commandErrorText(error).trim());
  }
}

async function labeledContainerPreviewUrl(worktree: string) {
  const containers = await previewContainers(false);
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

async function previewContainers(includeStopped: boolean) {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "ps",
        ...(includeStopped ? ["-a"] : []),
        "--filter",
        "label=blame.preview=true",
        "--format",
        "{{.ID}}",
      ],
    );
    const ids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (ids.length === 0) return [];
    const { stdout: inspectOutput } = await execFileAsync("docker", [
      "inspect",
      ...ids,
    ]);
    const parsed = JSON.parse(inspectOutput) as unknown;
    return Array.isArray(parsed) ? (parsed as DockerContainer[]) : [];
  } catch {
    return [];
  }
}

function containerMatchesWorktree(
  container: DockerContainer,
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

async function previewContainerForWorktree(worktree: string) {
  const containers = await previewContainers(true);
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
  void appendFile(setupLogPath(worktree), setupLogText(type, data), "utf8");
  emitSetupEvent(runId, type, data);
}

function setupLogText(type: "stdout" | "stderr" | "exit", data: string) {
  if (type !== "exit") return data;
  return `\n[setup exited with code ${data}]\n`;
}

async function gitRootCommits(cwd: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd },
    );
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
