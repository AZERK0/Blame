import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { execa } from "execa";

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
};

export type TaskExecutionResult = {
  status: "cancelled" | "execution_error" | "failed" | "passed" | "timed_out";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  isolation: "bubblewrap" | "sandbox_exec";
};

export interface TaskExecutor {
  execute(input: TaskExecutionInput): Promise<TaskExecutionResult>;
  capability(): Promise<"bubblewrap" | "sandbox_exec">;
}

export class SandboxedTaskExecutor implements TaskExecutor {
  async capability() {
    if (process.platform === "darwin") {
      if (await executableExists("sandbox-exec"))
        return "sandbox_exec" as const;
    } else if (process.platform === "linux") {
      if (await executableExists("bwrap")) return "bubblewrap" as const;
    }
    throw new Error(
      "UNSUPPORTED_CAPABILITY:No supported process sandbox is installed. Blame requires sandbox-exec on macOS or bubblewrap on Linux.",
    );
  }

  async execute(input: TaskExecutionInput): Promise<TaskExecutionResult> {
    const isolation = await this.capability();
    const readRoots = await executionReadRoots(input);
    const deniedReadRoots =
      isolation === "sandbox_exec"
        ? await canonicalExistingPaths([
            homedir(),
            tmpdir(),
            ...(input.canonicalWorkspaceRoot
              ? [input.canonicalWorkspaceRoot]
              : []),
          ])
        : [];
    const executionInput =
      isolation === "sandbox_exec"
        ? { ...input, overlayRoot: await realpath(input.overlayRoot) }
        : input;
    const command =
      isolation === "bubblewrap"
        ? bubblewrapCommand(executionInput, readRoots)
        : sandboxExecCommand(executionInput, readRoots, deniedReadRoots);
    const environment = taskEnvironment(executionInput.overlayRoot);
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
      const stdout = String(result.stdout ?? "");
      const stderr = String(result.stderr ?? "");
      return {
        status: result.isCanceled
          ? "cancelled"
          : result.timedOut
            ? "timed_out"
            : result.failed
              ? "failed"
              : "passed",
        exitCode: result.exitCode ?? null,
        signal: result.signal ?? null,
        stdout,
        stderr,
        outputTruncated:
          Buffer.byteLength(stdout) + Buffer.byteLength(stderr) >=
          input.outputBytes,
        isolation,
      };
    } catch (error) {
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
      };
    }
  }
}

function bubblewrapCommand(input: TaskExecutionInput, readRoots: string[]) {
  return {
    executable: "bwrap",
    args: [
      "--die-with-parent",
      "--new-session",
      "--unshare-net",
      ...readRoots.flatMap((root) => ["--ro-bind", root, root]),
      "--tmpfs",
      "/tmp",
      "--bind",
      input.overlayRoot,
      input.overlayRoot,
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
    "(deny network*)",
  ].join(" ");
  return {
    executable: "sandbox-exec",
    args: ["-p", profile, input.executable, ...input.args],
  };
}

function taskEnvironment(overlayRoot: string): Record<string, string> {
  const inheritedPath = process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin";
  return {
    PATH: [join(overlayRoot, "node_modules", ".bin"), inheritedPath].join(
      delimiter,
    ),
    HOME: join(overlayRoot, ".home"),
    TMPDIR: join(overlayRoot, ".tmp"),
    XDG_CACHE_HOME: join(overlayRoot, ".home", ".cache"),
    COREPACK_HOME: join(overlayRoot, ".home", ".cache", "corepack"),
    CI: "1",
    NO_COLOR: "1",
    LANG: process.env.LANG ?? "C.UTF-8",
    LC_ALL: process.env.LC_ALL ?? process.env.LANG ?? "C.UTF-8",
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    ALL_PROXY: "http://127.0.0.1:9",
    NO_PROXY: "",
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  };
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
        return candidate;
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
