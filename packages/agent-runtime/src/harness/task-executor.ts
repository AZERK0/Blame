import { constants } from "node:fs";
import {
  access,
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import { execa } from "execa";
import {
  resolvePackageManager,
  type PackageManagerCompatibility,
  type PackageManagerName,
  type ResolvedPackageManager,
} from "./package-manager-runtime.js";
import { startRegistryAllowlistProxy } from "./registry-allowlist-proxy.js";

export type TaskExecutionInput = {
  executable: string;
  args: string[];
  cwd: string;
  overlayRoot: string;
  canonicalWorkspaceRoot?: string;
  readonlyRoots?: string[];
  timeoutMs: number;
  outputBytes: number;
  signal?: AbortSignal;
  network?: "deny" | "project_allowlist";
  dependencyCacheRoot?: string;
  packageManager?: PackageManagerName;
  packageManagerCompatibility?: PackageManagerCompatibility;
  packageManagerVersion?: string;
  dependencyInstall?: boolean;
};

export type PackageManagerResolution = {
  name: PackageManagerName;
  requestedVersion?: string;
  resolvedVersion: string;
  strategy: ResolvedPackageManager["resolutionStrategy"];
};

export type TaskExecutionResult = {
  status: "cancelled" | "execution_error" | "failed" | "passed" | "timed_out";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  isolation: TaskIsolation;
  packageManagerResolution?: PackageManagerResolution;
};

export type TaskExecutorHealth = {
  available: boolean;
  isolation: TaskIsolation;
  stderr?: string;
};

export type DependencyExecutorCapability = {
  available: boolean;
  network: "cache_only" | "managed_allowlist";
  reason?: string;
};

export type TaskIsolation = "bubblewrap" | "sandbox_exec" | "worktree";

export interface TaskExecutor {
  execute(input: TaskExecutionInput): Promise<TaskExecutionResult>;
  capability(): Promise<TaskIsolation>;
  healthCheck?(input: TaskExecutionInput): Promise<TaskExecutorHealth>;
  dependencyCapability?(): Promise<DependencyExecutorCapability>;
}

export class SandboxedTaskExecutor implements TaskExecutor {
  private readonly healthChecks = new Map<
    string,
    Promise<TaskExecutorHealth>
  >();

  async capability() {
    if (process.platform === "darwin") {
      if (await executableExists("sandbox-exec"))
        return "sandbox_exec" as const;
    } else if (process.platform === "linux") {
      if (await executableExists("bwrap")) return "bubblewrap" as const;
    }
    return "worktree" as const;
  }

  async dependencyCapability(): Promise<DependencyExecutorCapability> {
    return {
      available: true,
      network: "managed_allowlist",
    };
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    const isolation = await this.capability();
    const prepared = await prepareTaskExecution(input).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    if ("error" in prepared)
      return infrastructureFailure(isolation, prepared.error);
    const runtime = await packageManagerRuntime(prepared).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    if ("error" in runtime)
      return infrastructureFailure(isolation, runtime.error);
    try {
      return await executePreparedTask(
        input,
        {
          ...prepared,
          runtimeBinRoots: [...runtime.binRoots, ...prepared.runtimeBinRoots],
        },
        isolation,
      );
    } finally {
      await runtime.cleanup();
    }
  }

  async healthCheck(input: TaskExecutionInput) {
    const isolation = await this.capability();
    const prepared = await prepareTaskExecution(input).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
    if ("error" in prepared)
      return unavailableHealth(isolation, prepared.error);
    const unstable = unstableSandboxExecutable(prepared, isolation);
    if (unstable) return unavailableHealth(isolation, unstable);
    const key = healthCheckKey(prepared, isolation);
    const existing = this.healthChecks.get(key);
    if (existing) return existing;
    const checking = probeExecutor(prepared, isolation);
    this.healthChecks.set(key, checking);
    return checking;
  }
}

async function executePreparedTask(
  input: TaskExecutionInput,
  prepared: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
): Promise<TaskExecutionResult> {
  const context = await commandExecutionContext(input, prepared, isolation);
  if ("error" in context)
    return infrastructureFailure(isolation, context.error);
  try {
    return await runPreparedCommand(
      input,
      prepared,
      context.command,
      context.environment,
      isolation,
    );
  } finally {
    await context.cleanup();
  }
}

async function commandExecutionContext(
  input: TaskExecutionInput,
  prepared: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
): Promise<CommandExecutionContext | { error: string }> {
  const readRoots = await executionReadRoots(prepared);
  const deniedReadRoots = await executionDeniedRoots(prepared, isolation);
  const executionInput =
    isolation === "sandbox_exec"
      ? { ...prepared, overlayRoot: await realpath(prepared.overlayRoot) }
      : prepared;
  const command = executionCommand(
    executionInput,
    isolation,
    readRoots,
    deniedReadRoots,
  );
  const registry = await registryExecutionContext(input, prepared);
  if ("error" in registry) return registry;
  return {
    command,
    environment: taskEnvironment(
      executionInput.overlayRoot,
      prepared.network ?? "deny",
      prepared.dependencyCacheRoot,
      prepared.runtimeBinRoots,
      registry.url,
    ),
    cleanup: registry.cleanup,
  };
}

function executionDeniedRoots(
  input: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
) {
  if (isolation !== "sandbox_exec") return Promise.resolve([]);
  return canonicalExistingPaths([
    homedir(),
    tmpdir(),
    ...(input.canonicalWorkspaceRoot ? [input.canonicalWorkspaceRoot] : []),
  ]);
}

async function localRegistryProxy(
  prepared: PreparedTaskExecutionInput,
  externalProxy: string | undefined,
  input: TaskExecutionInput,
) {
  if (prepared.network !== "project_allowlist" || externalProxy)
    return undefined;
  return startRegistryAllowlistProxy({
    cwd: prepared.cwd,
    overlayRoot: prepared.overlayRoot,
    signal: input.signal,
  }).catch(() => undefined);
}

async function registryExecutionContext(
  input: TaskExecutionInput,
  prepared: PreparedTaskExecutionInput,
): Promise<RegistryExecutionContext | { error: string }> {
  const externalProxy = projectAllowlistProxy();
  const localProxy = await localRegistryProxy(prepared, externalProxy, input);
  if (prepared.network === "project_allowlist" && !externalProxy && !localProxy)
    return {
      error:
        "REGISTRY_PROXY_UNAVAILABLE:The configured-registry proxy could not start.",
    };
  return {
    url: externalProxy ?? localProxy?.url,
    cleanup: async () => {
      await localProxy?.close();
    },
  };
}

async function runPreparedCommand(
  input: TaskExecutionInput,
  prepared: PreparedTaskExecutionInput,
  command: { executable: string; args: string[] },
  environment: Record<string, string>,
  isolation: TaskIsolation,
): Promise<TaskExecutionResult> {
  try {
    const result = await execa(command.executable, command.args, {
      cancelSignal: input.signal,
      cwd: input.cwd,
      env: environment,
      extendEnv: false,
      maxBuffer: input.outputBytes,
      reject: false,
      stdin: "ignore",
      stripFinalNewline: false,
      timeout: input.timeoutMs,
    });
    return completedExecution(result, input, prepared, isolation);
  } catch (error) {
    return failedExecution(error, input, prepared, isolation);
  }
}

function completedExecution(
  result: Awaited<ReturnType<typeof execa>>,
  input: TaskExecutionInput,
  prepared: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
): TaskExecutionResult {
  const stdout = String(result.stdout ?? "");
  const stderr = String(result.stderr ?? "");
  return {
    status: completedExecutionStatus(result, input, stdout, stderr),
    exitCode: result.exitCode ?? null,
    signal: result.signal ?? null,
    stdout,
    stderr,
    outputTruncated:
      Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >=
      input.outputBytes,
    isolation,
    ...packageManagerExecution(prepared),
  };
}

function completedExecutionStatus(
  result: Awaited<ReturnType<typeof execa>>,
  input: TaskExecutionInput,
  stdout: string,
  stderr: string,
): TaskExecutionResult["status"] {
  if (result.isCanceled) return "cancelled";
  if (result.timedOut) return "timed_out";
  if (!result.failed) return "passed";
  return dependencyWorkspaceFailure(input, `${stderr}\n${stdout}`)
    ? "execution_error"
    : "failed";
}

function dependencyWorkspaceFailure(input: TaskExecutionInput, output: string) {
  if (!input.dependencyInstall) return false;
  return /(?:dependency_workspace_readonly|(?:enoent|eacces|erofs|read-only file system)[^\n]*node_modules[\\/](?:\.pnpm)?)/iu.test(
    output,
  );
}

function failedExecution(
  error: unknown,
  input: TaskExecutionInput,
  prepared: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
): TaskExecutionResult {
  const failure = executionFailure(error);
  return {
    status:
      input.signal?.aborted || failure.isCanceled
        ? "cancelled"
        : failure.timedOut
          ? "timed_out"
          : "execution_error",
    exitCode: failure.exitCode,
    signal: failure.signal,
    stdout: failure.stdout,
    stderr: failure.stderr || failure.message,
    outputTruncated: failure.maxBufferExceeded,
    isolation,
    ...packageManagerExecution(prepared),
  };
}

function packageManagerExecution(input: PreparedTaskExecutionInput) {
  return input.packageManagerResolution
    ? { packageManagerResolution: input.packageManagerResolution }
    : {};
}

function unavailableHealth(isolation: TaskIsolation, stderr: string) {
  return { available: false, isolation, stderr };
}

function unstableSandboxExecutable(
  input: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
) {
  if (isolation !== "bubblewrap") return undefined;
  const temporaryRoot = `${tmpdir().replace(/\/$/u, "")}/`;
  if (!input.executable.startsWith(temporaryRoot)) return undefined;
  return `EXECUTOR_UNAVAILABLE:${input.executable} is mounted from a temporary runtime path that bubblewrap cannot preserve. Provision a stable package-manager executable.`;
}

function healthCheckKey(
  input: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
) {
  return [
    isolation,
    input.executable,
    input.packageManagerResolution?.resolvedVersion ?? "direct",
    input.network ?? "deny",
  ].join("\0");
}

async function probeExecutor(
  input: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
): Promise<TaskExecutorHealth> {
  const executable = await systemTrueExecutable();
  const probeInput = { ...input, executable, args: [] };
  const readRoots = await executionReadRoots(probeInput);
  const deniedRoots = await probeDeniedRoots(probeInput, isolation);
  const command = executionCommand(
    probeInput,
    isolation,
    readRoots,
    deniedRoots,
  );
  try {
    const result = await execa(command.executable, command.args, {
      cwd: probeInput.cwd,
      env: taskEnvironment(
        probeInput.overlayRoot,
        probeInput.network ?? "deny",
        probeInput.dependencyCacheRoot,
        probeInput.runtimeBinRoots,
        projectAllowlistProxy(),
      ),
      extendEnv: false,
      reject: false,
      stdin: "ignore",
      timeout: Math.min(5_000, probeInput.timeoutMs),
    });
    if (!result.failed) return { available: true, isolation };
    return unavailableHealth(
      isolation,
      String(result.stderr || result.stdout || "Executor probe failed."),
    );
  } catch (error) {
    return unavailableHealth(isolation, executionFailure(error).message);
  }
}

async function probeDeniedRoots(
  input: PreparedTaskExecutionInput,
  isolation: TaskIsolation,
) {
  if (isolation !== "sandbox_exec") return [];
  return canonicalExistingPaths([
    homedir(),
    tmpdir(),
    ...(input.canonicalWorkspaceRoot ? [input.canonicalWorkspaceRoot] : []),
  ]);
}

async function systemTrueExecutable() {
  const roots = ["/usr/bin", "/bin"];
  return (await executablePath("true", roots)) ?? "/usr/bin/true";
}

function executionCommand(
  input: TaskExecutionInput,
  isolation: TaskIsolation,
  readRoots: string[],
  deniedReadRoots: string[],
) {
  if (isolation === "bubblewrap") return bubblewrapCommand(input, readRoots);
  if (isolation === "sandbox_exec")
    return sandboxExecCommand(input, readRoots, deniedReadRoots);
  return { executable: input.executable, args: input.args };
}

function bubblewrapCommand(input: TaskExecutionInput, readRoots: string[]) {
  return {
    executable: "bwrap",
    args: [
      "--die-with-parent",
      "--new-session",
      ...(input.network === "project_allowlist" ? [] : ["--unshare-net"]),
      "--tmpfs",
      "/tmp",
      ...readRoots.flatMap((root) => ["--ro-bind", root, root]),
      "--bind",
      input.overlayRoot,
      input.overlayRoot,
      ...(input.dependencyCacheRoot
        ? ["--bind", input.dependencyCacheRoot, input.dependencyCacheRoot]
        : []),
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--chdir",
      input.cwd,
      "--",
      input.executable,
      ...input.args,
    ],
  };
}

function sandboxExecCommand(
  input: TaskExecutionInput,
  readRoots: string[],
  deniedRoots: string[],
) {
  const writableOverlay = seatbeltString(input.overlayRoot);
  const profile = [
    "(version 1)",
    "(deny default)",
    "(allow process*)",
    "(allow file-read*)",
    ...deniedRoots.map(
      (root) => `(deny file-read-data (subpath ${seatbeltString(root)}))`,
    ),
    ...readRoots.map(
      (root) => `(allow file-read-data (subpath ${seatbeltString(root)}))`,
    ),
    `(allow file-read-data (subpath ${writableOverlay}))`,
    "(allow sysctl-read)",
    "(allow mach-lookup)",
    `(allow file-write* (subpath ${writableOverlay}))`,
    ...(input.dependencyCacheRoot
      ? [
          `(allow file-write* (subpath ${seatbeltString(input.dependencyCacheRoot)}))`,
        ]
      : []),
    input.network === "project_allowlist"
      ? "(allow network*)"
      : "(deny network*)",
  ].join(" ");
  return {
    executable: "sandbox-exec",
    args: ["-p", profile, input.executable, ...input.args],
  };
}

function taskEnvironment(
  overlayRoot: string,
  network: "deny" | "project_allowlist",
  dependencyCacheRoot?: string,
  runtimeBinRoots: string[] = [],
  projectProxy?: string,
): Record<string, string> {
  const inheritedPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  const proxy = network === "project_allowlist" ? projectProxy : undefined;
  return {
    PATH: [
      ...runtimeBinRoots,
      join(overlayRoot, "node_modules", ".bin"),
      inheritedPath,
    ].join(delimiter),
    HOME: join(overlayRoot, ".home"),
    TMPDIR: join(overlayRoot, ".tmp"),
    XDG_CACHE_HOME: join(overlayRoot, ".home", ".cache"),
    COREPACK_HOME: join(overlayRoot, ".home", ".cache", "corepack"),
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "0",
    COREPACK_ENABLE_STRICT: "0",
    npm_config_manage_package_manager_versions: "false",
    pnpm_config_manage_package_manager_versions: "false",
    CI: "1",
    NO_COLOR: "1",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? "C.UTF-8",
    HTTP_PROXY: proxy ?? "http://127.0.0.1:9",
    HTTPS_PROXY: proxy ?? "http://127.0.0.1:9",
    ALL_PROXY: proxy ?? "http://127.0.0.1:9",
    NO_PROXY: "",
    npm_config_offline: network === "deny" ? "true" : "false",
    npm_config_audit: "false",
    npm_config_fund: "false",
    ...(dependencyCacheRoot
      ? {
          npm_config_cache: join(dependencyCacheRoot, "npm"),
          pnpm_config_store_dir: join(dependencyCacheRoot, "pnpm"),
          YARN_CACHE_FOLDER: join(dependencyCacheRoot, "yarn"),
        }
      : {}),
  };
}

type PreparedTaskExecutionInput = TaskExecutionInput & {
  managerArgsPrefix: string[];
  packageManagerResolution?: PackageManagerResolution;
  runtimeBinRoots: string[];
};

type CommandExecutionContext = {
  cleanup: () => Promise<void>;
  command: { executable: string; args: string[] };
  environment: Record<string, string>;
};

type RegistryExecutionContext = {
  cleanup: () => Promise<void>;
  url?: string;
};

type PackageManagerRuntime = {
  binRoots: string[];
  cleanup: () => Promise<void>;
};

async function packageManagerRuntime(
  input: PreparedTaskExecutionInput,
): Promise<PackageManagerRuntime> {
  if (!input.packageManager || !input.packageManagerResolution)
    return { binRoots: [], cleanup: async () => undefined };
  const directory = await mkdtemp(
    join(input.overlayRoot, ".blame-package-manager-"),
  );
  try {
    await writePackageManagerLaunchers(directory, input);
    return {
      binRoots: [directory],
      cleanup: () => rm(directory, { force: true, recursive: true }),
    };
  } catch (error) {
    await rm(directory, { force: true, recursive: true });
    throw error;
  }
}

async function writePackageManagerLaunchers(
  directory: string,
  input: PreparedTaskExecutionInput,
) {
  const command = [input.executable, ...resolvedManagerPrefix(input)];
  const shellPath = join(directory, input.packageManager!);
  const windowsPath = `${shellPath}.cmd`;
  await Promise.all([
    writeFile(
      shellPath,
      `#!/bin/sh\nexec ${command.map(shellQuote).join(" ")} "$@"\n`,
    ),
    writeFile(windowsPath, `@${command.map(windowsQuote).join(" ")} %*\r\n`),
  ]);
  if (process.platform !== "win32") await chmod(shellPath, 0o755);
}

function resolvedManagerPrefix(input: PreparedTaskExecutionInput) {
  return input.managerArgsPrefix;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function windowsQuote(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function prepareTaskExecution(input: TaskExecutionInput) {
  await prepareDependencyWorkspace(input);
  const prepared = await preparePackageManager(input);
  const roots = [
    ...prepared.runtimeBinRoots,
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean),
  ];
  const executable = await executablePath(prepared.executable, roots);
  if (!executable)
    throw new Error(
      `EXECUTABLE_UNAVAILABLE:${prepared.executable} is not executable in this runtime.`,
    );
  return { ...prepared, executable };
}

async function prepareDependencyWorkspace(input: TaskExecutionInput) {
  if (!input.dependencyInstall) return;
  const directory = join(input.overlayRoot, "node_modules");
  try {
    const entry = await lstat(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory())
      throw new Error(
        "DEPENDENCY_WORKSPACE_READONLY:node_modules must be a writable overlay directory.",
      );
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
  }
  await access(directory, constants.W_OK);
}

async function preparePackageManager(
  input: TaskExecutionInput,
): Promise<PreparedTaskExecutionInput> {
  if (!input.packageManager)
    return { ...input, managerArgsPrefix: [], runtimeBinRoots: [] };
  const manager = await resolvePackageManager({
    compatibility: input.packageManagerCompatibility,
    name: input.packageManager,
    version: input.packageManagerVersion,
  });
  const managerArgsPrefix = [
    ...manager.argsPrefix,
    ...packageManagerRuntimeOptions(input.packageManager),
  ];
  return {
    ...input,
    executable: manager.executable,
    args: [...managerArgsPrefix, ...input.args],
    managerArgsPrefix,
    readonlyRoots: [...(input.readonlyRoots ?? []), ...manager.readonlyRoots],
    packageManagerResolution: {
      name: input.packageManager,
      ...(manager.requestedVersion
        ? { requestedVersion: manager.requestedVersion }
        : {}),
      resolvedVersion: manager.resolvedVersion,
      strategy: manager.resolutionStrategy,
    },
    runtimeBinRoots: manager.argsPrefix.length
      ? []
      : [dirname(manager.executable)],
  };
}

function packageManagerRuntimeOptions(packageManager: PackageManagerName) {
  return packageManager === "pnpm"
    ? ["--config.manage-package-manager-versions=false"]
    : [];
}

function infrastructureFailure(
  isolation: TaskIsolation,
  message: string,
): TaskExecutionResult {
  return {
    status: "execution_error",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: message,
    outputTruncated: false,
    isolation,
  };
}

function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  return "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function projectAllowlistProxy() {
  return process.env.BLAME_PROJECT_ALLOWLIST_PROXY?.trim() || undefined;
}

export function automaticDependencyNetworkPolicy() {
  return "project_allowlist" as const;
}

async function executionReadRoots(input: TaskExecutionInput) {
  const pathRoots = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const executable = await executablePath(input.executable, pathRoots);
  const candidates = [
    ...(process.platform === "darwin"
      ? [
          "/System",
          "/Library",
          "/usr",
          "/bin",
          "/sbin",
          "/opt",
          "/private/etc",
          "/private/var/db",
          "/dev",
        ]
      : ["/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc", "/opt"]),
    ...pathRoots,
    ...(executable ? [dirname(executable), dirname(dirname(executable))] : []),
    ...(input.readonlyRoots ?? []),
  ];
  const available = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await access(candidate, constants.R_OK);
        return isAbsolute(candidate) ? candidate : await realpath(candidate);
      } catch {
        return undefined;
      }
    }),
  );
  return [...new Set(available.filter((value): value is string => !!value))];
}

async function executablePath(name: string, roots: string[]) {
  const candidates = name.includes("/")
    ? [name]
    : roots.map((root) => join(root, name));
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Continue through the remaining executable candidates.
    }
  }
  return undefined;
}

async function canonicalExistingPaths(paths: string[]) {
  const resolved = await Promise.all(
    paths.map(async (path) => {
      try {
        return await realpath(path);
      } catch {
        return undefined;
      }
    }),
  );
  return [...new Set(resolved.filter((value): value is string => !!value))];
}

async function executableExists(name: string) {
  const paths = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  for (const path of paths) {
    try {
      await access(join(path, name), constants.X_OK);
      return true;
    } catch {
      // Continue through PATH entries that do not contain the executable.
    }
  }
  return false;
}

function seatbeltString(value: string) {
  return JSON.stringify(value.replaceAll("\\", "/"));
}

function executionFailure(error: unknown) {
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    isCanceled: value.isCanceled === true,
    timedOut: value.timedOut === true,
    maxBufferExceeded:
      value.isMaxBuffer === true ||
      (error instanceof Error && error.name === "MaxBufferError"),
    exitCode: typeof value.exitCode === "number" ? value.exitCode : null,
    signal: typeof value.signal === "string" ? value.signal : null,
    stdout: typeof value.stdout === "string" ? value.stdout : "",
    stderr: typeof value.stderr === "string" ? value.stderr : "",
    message: error instanceof Error ? error.message : String(error),
  };
}
