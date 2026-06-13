import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  runtimeCommand,
  runtimeName,
  type ContainerRuntimeCommand,
} from "./container-runtime.ts";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 15_000;

export type RuntimeState =
  | "ready"
  | "missing"
  | "repairable"
  | "unsupported"
  | "broken";

export type RuntimeDependencyName =
  | "blame-runtime"
  | "containerd"
  | "nerdctl"
  | "nerdctl-compose";

export type RuntimeDependencyStatus =
  | "missing"
  | "unavailable"
  | "unsupported";

export type RuntimeDependencyIssue = {
  error?: unknown;
  name: RuntimeDependencyName;
  runtimeStatus?: RuntimeState;
  status: RuntimeDependencyStatus;
};

export type RuntimeStatusReport = {
  issues: RuntimeDependencyIssue[];
  platform: NodeJS.Platform;
  runtime: string;
  status: RuntimeState;
};

export type RuntimeManagerInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
};

export type RuntimeCommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<string>;

type RuntimeManagerContext = {
  env?: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  run: RuntimeCommandRunner;
};

export class RuntimeManager {
  private readonly context: RuntimeManagerContext;

  constructor(
    input: RuntimeManagerInput = {},
    run: RuntimeCommandRunner = runCommand,
  ) {
    this.context = {
      env: input.env,
      platform: input.platform ?? process.platform,
      run,
    };
  }

  getRuntimeStatus() {
    return this.checkRuntimeDependencies();
  }

  async checkRuntimeDependencies(): Promise<RuntimeStatusReport> {
    const issues = await runtimeDependencyIssues(this.context);
    return runtimeStatusReport(this.context.platform, issues);
  }

  async ensureRuntimeReady() {
    await runRuntimeLifecycleCommand(this.context, "ensure");
    return this.checkRuntimeDependencies();
  }

  async repairRuntime() {
    await runRuntimeLifecycleCommand(this.context, "repair");
    return this.checkRuntimeDependencies();
  }

  async resetRuntime() {
    await runRuntimeLifecycleCommand(this.context, "reset");
    return this.checkRuntimeDependencies();
  }

  async uninstallRuntime() {
    await runRuntimeLifecycleCommand(this.context, "uninstall");
    return this.checkRuntimeDependencies();
  }
}

export function createRuntimeManager(
  input: RuntimeManagerInput = {},
  run: RuntimeCommandRunner = runCommand,
) {
  return new RuntimeManager(input, run);
}

export function getRuntimeStatus(input: RuntimeManagerInput = {}) {
  return createRuntimeManager(input).getRuntimeStatus();
}

export function checkRuntimeDependencies(input: RuntimeManagerInput = {}) {
  return createRuntimeManager(input).checkRuntimeDependencies();
}

export function ensureRuntimeReady(input: RuntimeManagerInput = {}) {
  return createRuntimeManager(input).ensureRuntimeReady();
}

export function repairRuntime(input: RuntimeManagerInput = {}) {
  return createRuntimeManager(input).repairRuntime();
}

export function resetRuntime(input: RuntimeManagerInput = {}) {
  return createRuntimeManager(input).resetRuntime();
}

export function uninstallRuntime(input: RuntimeManagerInput = {}) {
  return createRuntimeManager(input).uninstallRuntime();
}

async function runtimeDependencyIssues(context: RuntimeManagerContext) {
  if (!supportedRuntimePlatform(context.platform)) {
    return [runtimeIssue("blame-runtime", "unsupported")];
  }
  if (context.platform === "linux") return linuxRuntimeIssues(context);
  return managedRuntimeIssues(context);
}

async function linuxRuntimeIssues(context: RuntimeManagerContext) {
  const nerdctlIssue = await checkLinuxNerdctl(context);
  if (nerdctlIssue) return [nerdctlIssue];
  const connectionIssue = await checkRuntimeConnection(context);
  if (connectionIssue) return [connectionIssue];
  const composeIssue = await checkRuntimeTool(context, "compose", ["version"]);
  return composeIssue ? [composeIssue] : [];
}

async function managedRuntimeIssues(context: RuntimeManagerContext) {
  const binaryIssue = await checkManagedRuntimeBinary(context);
  if (binaryIssue) return [binaryIssue];
  const statusIssue = await checkManagedRuntimeStatus(context);
  return statusIssue ? [statusIssue] : [];
}

async function checkLinuxNerdctl(context: RuntimeManagerContext) {
  try {
    await context.run("nerdctl", ["--version"], context.env);
    return null;
  } catch (error) {
    return runtimeIssue("nerdctl", "missing", error);
  }
}

async function checkRuntimeConnection(context: RuntimeManagerContext) {
  try {
    await runRuntimeCommand(context, "info", []);
    return null;
  } catch (error) {
    return runtimeIssue("containerd", "unavailable", error);
  }
}

async function checkRuntimeTool(
  context: RuntimeManagerContext,
  command: ContainerRuntimeCommand,
  args: string[],
) {
  try {
    await runRuntimeCommand(context, command, args);
    return null;
  } catch (error) {
    return runtimeIssue("nerdctl-compose", "missing", error);
  }
}

async function checkManagedRuntimeBinary(context: RuntimeManagerContext) {
  try {
    await context.run(runtimeBinary(context.platform), ["--version"], context.env);
    return null;
  } catch (error) {
    return runtimeIssue("blame-runtime", "missing", error, "missing");
  }
}

async function checkManagedRuntimeStatus(context: RuntimeManagerContext) {
  try {
    const output = await context.run(runtimeBinary(context.platform), [
      "status",
    ], context.env);
    const status = parseRuntimeState(output);
    return status === "ready" ? null : managedRuntimeStatusIssue(status);
  } catch (error) {
    return runtimeIssue("blame-runtime", "unavailable", error, "broken");
  }
}

function runRuntimeCommand(
  context: RuntimeManagerContext,
  command: ContainerRuntimeCommand,
  args: string[],
) {
  const spec = runtimeCommand(context.platform, command, args);
  return context.run(spec.command, spec.args, context.env);
}

function runRuntimeLifecycleCommand(
  context: RuntimeManagerContext,
  command: "ensure" | "repair" | "reset" | "uninstall",
) {
  if (context.platform === "linux") return Promise.resolve("");
  if (!managedRuntimePlatform(context.platform)) {
    throw new Error(`Unsupported runtime platform: ${context.platform}`);
  }
  return context.run(runtimeBinary(context.platform), [command], context.env);
}

function runtimeStatusReport(
  platform: NodeJS.Platform,
  issues: RuntimeDependencyIssue[],
): RuntimeStatusReport {
  return {
    issues,
    platform,
    runtime: runtimeName(platform),
    status: runtimeState(issues),
  };
}

function runtimeState(issues: RuntimeDependencyIssue[]): RuntimeState {
  const issue = issues[0];
  if (!issue) return "ready";
  if (issue.runtimeStatus) return issue.runtimeStatus;
  if (issue.status === "unsupported") return "unsupported";
  if (issue.status === "missing") return "missing";
  if (issue.name === "containerd") return "repairable";
  return "broken";
}

function runtimeIssue(
  name: RuntimeDependencyName,
  status: RuntimeDependencyStatus,
  error?: unknown,
  runtimeStatus?: RuntimeState,
): RuntimeDependencyIssue {
  return { error, name, runtimeStatus, status };
}

function managedRuntimeStatusIssue(status: RuntimeState) {
  if (status === "missing") {
    return runtimeIssue("blame-runtime", "missing", undefined, "missing");
  }
  if (status === "unsupported") {
    return runtimeIssue("blame-runtime", "unsupported", undefined, "unsupported");
  }
  return runtimeIssue("blame-runtime", "unavailable", undefined, status);
}

function parseRuntimeState(output: string): RuntimeState {
  const value = output.trim().toLowerCase();
  if (isRuntimeState(value)) return value;
  return "ready";
}

function isRuntimeState(value: string): value is RuntimeState {
  return ["ready", "missing", "repairable", "unsupported", "broken"].includes(
    value,
  );
}

function supportedRuntimePlatform(platform: NodeJS.Platform) {
  return platform === "linux" || managedRuntimePlatform(platform);
}

function managedRuntimePlatform(platform: NodeJS.Platform) {
  return platform === "darwin" || platform === "win32";
}

function runtimeBinary(platform: NodeJS.Platform) {
  if (platform === "darwin") return "blame-lima-runtime";
  if (platform === "win32") return "blame-wsl2-runtime";
  return "nerdctl";
}

async function runCommand(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) {
  const { stdout } = await execFileAsync(command, args, {
    env,
    shell: process.platform === "win32",
    timeout: commandTimeoutMs,
  });
  return stdout;
}
