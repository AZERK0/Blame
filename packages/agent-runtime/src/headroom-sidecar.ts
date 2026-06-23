import { execFile, spawn, type ChildProcess } from "node:child_process";
import { access, appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

type HeadroomSidecarLogger = (
  message: string,
  payload?: unknown,
) => void | Promise<void>;

export type HeadroomSidecarResult = {
  baseUrl: string;
  source: "configured" | "existing" | "sidecar";
};

export type HeadroomSidecarOptions = {
  env?: NodeJS.ProcessEnv;
  logger?: HeadroomSidecarLogger;
  logFile?: string;
  requestLogFile?: string;
};

const execFileAsync = promisify(execFile);
const defaultHeadroomPackage = "headroom-ai[proxy]==0.27.0";
const defaultHeadroomPort = 8787;
const defaultHealthTimeoutMs = 30_000;

export class HeadroomSidecar {
  private process?: ChildProcess;
  private result?: HeadroomSidecarResult;
  private startPromise?: Promise<HeadroomSidecarResult>;

  async ensure(options: HeadroomSidecarOptions = {}) {
    const env = options.env ?? process.env;
    const configuredBaseUrl = externalBaseUrl(env);
    if (configuredBaseUrl) {
      await log(options.logger, "headroom sidecar configured externally", {
        headroomBaseUrl: configuredBaseUrl,
        headroomSource: "configured",
      });
      return { baseUrl: configuredBaseUrl, source: "configured" } as const;
    }

    if (this.result && (await healthy(this.result.baseUrl))) return this.result;
    if (!this.startPromise) this.startPromise = this.ensureLocal(options);
    try {
      this.result = await this.startPromise;
      return this.result;
    } finally {
      this.startPromise = undefined;
    }
  }

  async dispose() {
    this.process?.kill();
    this.process = undefined;
    this.result = undefined;
    this.startPromise = undefined;
  }

  private async ensureLocal(options: HeadroomSidecarOptions) {
    const env = options.env ?? process.env;
    const port = headroomPort(env);
    const baseUrl = `http://127.0.0.1:${port}`;
    if (await healthy(baseUrl)) {
      await log(options.logger, "headroom sidecar reused existing proxy", {
        headroomBaseUrl: baseUrl,
        headroomPort: port,
        headroomSource: "existing",
      });
      return { baseUrl, source: "existing" } as const;
    }
    return this.startLocalProxy(baseUrl, port, options);
  }

  private async startLocalProxy(
    baseUrl: string,
    port: number,
    options: HeadroomSidecarOptions,
  ) {
    const command = await headroomCommand(options);
    await log(options.logger, "headroom sidecar starting", {
      headroomBaseUrl: baseUrl,
      headroomCommand: command,
      headroomPort: port,
      headroomSource: "sidecar",
    });
    this.process = spawnHeadroom(command, port, options);
    try {
      await waitForProcessHealth(baseUrl, this.process, defaultHealthTimeoutMs);
    } catch (error) {
      this.process.kill();
      this.process = undefined;
      throw error;
    }
    await log(options.logger, "headroom sidecar ready", {
      headroomBaseUrl: baseUrl,
      headroomPort: port,
      headroomSource: "sidecar",
    });
    return { baseUrl, source: "sidecar" } as const;
  }
}

export function externalBaseUrl(env: NodeJS.ProcessEnv = process.env) {
  return env.BLAME_HEADROOM_BASE_URL || env.HEADROOM_BASE_URL;
}

export function headroomPort(env: NodeJS.ProcessEnv = process.env) {
  return (
    positiveInteger(env.BLAME_HEADROOM_PORT || env.HEADROOM_PORT) ??
    defaultHeadroomPort
  );
}

async function headroomCommand(options: HeadroomSidecarOptions) {
  const env = options.env ?? process.env;
  if (env.BLAME_HEADROOM_COMMAND) return env.BLAME_HEADROOM_COMMAND;
  if (await commandAvailable("headroom")) return "headroom";
  return ensureHeadroomVenv(env, options.logger);
}

async function ensureHeadroomVenv(
  env: NodeJS.ProcessEnv,
  logger?: HeadroomSidecarLogger,
) {
  const venv = headroomVenvPath(env);
  const command = join(venv, executableDirectory(), executableName("headroom"));
  if (await fileExists(command)) return command;
  await mkdir(dirname(venv), { recursive: true });
  await log(logger, "headroom sidecar installing", {
    headroomPackage: headroomPackage(env),
    headroomVenv: venv,
  });
  await execFileAsync(pythonCommand(env), ["-m", "venv", venv], {
    maxBuffer: 1024 * 1024,
  });
  await execFileAsync(venvPython(venv), ["-m", "pip", "install", headroomPackage(env)], {
    maxBuffer: 20 * 1024 * 1024,
  });
  return command;
}

function spawnHeadroom(
  command: string,
  port: number,
  options: HeadroomSidecarOptions,
) {
  const args = proxyArgs(port, options.requestLogFile);
  const child = spawn(command, args, {
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeOutput(child, options.logFile);
  return child;
}

function proxyArgs(port: number, requestLogFile: string | undefined) {
  const args = ["proxy", "--host", "127.0.0.1", "--port", String(port)];
  return requestLogFile ? [...args, "--log-file", requestLogFile] : args;
}

function pipeOutput(
  child: ChildProcess,
  logFile: string | undefined,
) {
  if (!logFile) return;
  child.stdout?.on("data", (chunk) => {
    void appendProcessLog(logFile, chunk).catch(() => undefined);
  });
  child.stderr?.on("data", (chunk) => {
    void appendProcessLog(logFile, chunk).catch(() => undefined);
  });
}

async function appendProcessLog(file: string, chunk: Buffer) {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, chunk);
}

async function waitForProcessHealth(
  baseUrl: string,
  child: ChildProcess,
  timeoutMs: number,
) {
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let processError: Error | undefined;
  child.once("exit", (code, signal) => {
    exit = { code, signal };
  });
  child.once("error", (error) => {
    processError = error;
  });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(baseUrl)) return;
    if (processError) throw processError;
    if (exit) {
      throw new Error(
        `Headroom sidecar exited before healthcheck: ${JSON.stringify(exit)}.`,
      );
    }
    await delay(500);
  }
  throw new Error(`Headroom sidecar did not become healthy at ${baseUrl}.`);
}

async function healthy(baseUrl: string) {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function commandAvailable(command: string) {
  try {
    await execFileAsync(command, ["--version"], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function headroomVenvPath(env: NodeJS.ProcessEnv) {
  return (
    env.BLAME_HEADROOM_VENV ||
    join(homedir(), ".cache", "blame", "headroom", "0.27.0")
  );
}

function headroomPackage(env: NodeJS.ProcessEnv) {
  return env.BLAME_HEADROOM_PYTHON_PACKAGE || defaultHeadroomPackage;
}

function pythonCommand(env: NodeJS.ProcessEnv) {
  return env.BLAME_HEADROOM_PYTHON || "python3";
}

function venvPython(venv: string) {
  return join(venv, executableDirectory(), executableName("python"));
}

function executableDirectory() {
  return process.platform === "win32" ? "Scripts" : "bin";
}

function executableName(name: string) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function positiveInteger(value: string | undefined) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

async function log(
  logger: HeadroomSidecarLogger | undefined,
  message: string,
  payload?: unknown,
) {
  try {
    await logger?.(message, payload);
  } catch {
    return;
  }
}
