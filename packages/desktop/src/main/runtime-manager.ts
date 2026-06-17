import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  runtimeCommand,
  runtimeName,
  type ContainerRuntimeCommand,
} from "./container-runtime.ts";
import { runtimeToolScript } from "./host-tool-path.ts";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 15_000;
const lifecycleCommandTimeoutMs = 30 * 60_000;
const readinessTimeoutMs = 90_000;
const readinessPollIntervalMs = 1_000;

export type RuntimeState =
  | "ready"
  | "missing"
  | "repairable"
  | "unsupported"
  | "broken";

export type RuntimeDependencyName =
  | "blame-runtime"
  | "cline-sdk"
  | "containerd"
  | "git"
  | "nerdctl"
  | "nerdctl-compose";

export type RuntimeDependencyStatus =
  | "missing"
  | "unavailable"
  | "unsupported";

export type RuntimeDependencyIssue = {
  action?: string;
  error?: unknown;
  name: RuntimeDependencyName;
  runtimeStatus?: RuntimeState;
  status: RuntimeDependencyStatus;
};

type ManagedRuntimeCheckName =
  | "lima"
  | "vm"
  | "host-home"
  | "wsl"
  | "wsl2"
  | "distro"
  | "agent"
  | RuntimeDependencyName;

type ManagedRuntimeCheckStatus =
  | "available"
  | "missing"
  | "unavailable"
  | "unsupported";

type ManagedRuntimeStatusCheck = {
  action?: string;
  name: ManagedRuntimeCheckName;
  status: ManagedRuntimeCheckStatus;
};

type ManagedRuntimeStatusReport = {
  action?: string;
  checks?: ManagedRuntimeStatusCheck[];
  status?: RuntimeState;
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
  timeoutMs?: number,
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
    const report = await this.getRuntimeStatus();
    if (report.status === "ready") {
      return report;
    }
    await runRuntimeLifecycleCommand(this.context, "ensure");
    return waitForRuntimeReadiness(this.context);
  }

  async repairRuntime() {
    await runRuntimeLifecycleCommand(this.context, "repair");
    return waitForRuntimeReadiness(this.context);
  }

  async resetRuntime() {
    await runRuntimeLifecycleCommand(this.context, "reset");
    return waitForRuntimeReadiness(this.context);
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
  if (statusIssue) return [statusIssue];
  const agentIssue = await checkManagedRuntimeAgent(context);
  return agentIssue ? [agentIssue] : [];
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
    return managedRuntimeStatusIssueFromOutput(output);
  } catch (error) {
    return runtimeIssue("blame-runtime", "unavailable", error, "broken");
  }
}

async function checkManagedRuntimeAgent(context: RuntimeManagerContext) {
  try {
    const output = await context.run(runtimeBinary(context.platform), [
      "agent",
      "status",
    ], context.env);
    return parseRuntimeState(output) === "ready"
      ? null
      : managedRuntimeAgentIssue();
  } catch (error) {
    return managedRuntimeAgentIssue(error);
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
  return context.run(
    runtimeBinary(context.platform),
    [command],
    context.env,
    lifecycleCommandTimeoutMs,
  );
}

async function waitForRuntimeReadiness(context: RuntimeManagerContext) {
  const deadline = Date.now() + readinessTimeoutMs;
  let report = await runtimeStatusReportFromContext(context);
  while (runtimeReadinessPending(report) && Date.now() < deadline) {
    await sleep(readinessPollIntervalMs);
    report = await runtimeStatusReportFromContext(context);
  }
  return report;
}

async function runtimeStatusReportFromContext(context: RuntimeManagerContext) {
  const issues = await runtimeDependencyIssues(context);
  return runtimeStatusReport(context.platform, issues);
}

function runtimeReadinessPending(report: RuntimeStatusReport) {
  return report.status !== "ready" && report.status !== "unsupported";
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
  action?: string,
): RuntimeDependencyIssue {
  return { action, error, name, runtimeStatus, status };
}

function managedRuntimeAgentIssue(error?: unknown) {
  return runtimeIssue(
    "blame-runtime",
    "missing",
    error,
    "missing",
    "Repair BlameRuntime from Blame runtime setup.",
  );
}

function managedRuntimeStatusIssueFromOutput(output: string) {
  const report = parseManagedRuntimeStatusReport(output);
  if (!report) {
    const status = parseRuntimeState(output);
    return status === "ready" ? null : managedRuntimeStatusIssue(status);
  }
  const check = report.checks?.find((item) => item.status !== "available");
  if (!check) {
    const status = report.status ?? "ready";
    return status === "ready" ? null : managedRuntimeStatusIssue(status, report.action);
  }
  return managedRuntimeCheckIssue(check, report.status ?? "broken", report.action);
}

function managedRuntimeStatusIssue(status: RuntimeState, action?: string) {
  if (status === "missing") {
    return runtimeIssue("blame-runtime", "missing", undefined, "missing", action);
  }
  if (status === "unsupported") {
    return runtimeIssue(
      "blame-runtime",
      "unsupported",
      undefined,
      "unsupported",
      action,
    );
  }
  return runtimeIssue("blame-runtime", "unavailable", undefined, status, action);
}

function managedRuntimeCheckIssue(
  check: ManagedRuntimeStatusCheck,
  runtimeStatus: RuntimeState,
  fallbackAction?: string,
) {
  return runtimeIssue(
    runtimeDependencyName(check.name),
    runtimeDependencyStatus(check.status),
    undefined,
    runtimeStatusForCheck(check, runtimeStatus),
    check.action ?? fallbackAction,
  );
}

function runtimeDependencyName(name: ManagedRuntimeCheckName): RuntimeDependencyName {
  if (
    name === "lima"
    || name === "vm"
    || name === "wsl"
    || name === "wsl2"
    || name === "distro"
    || name === "host-home"
    || name === "agent"
  )
    return "blame-runtime";
  return name;
}

function runtimeDependencyStatus(
  status: ManagedRuntimeCheckStatus,
): RuntimeDependencyStatus {
  return status === "available" ? "unavailable" : status;
}

function runtimeStatusForCheck(
  check: ManagedRuntimeStatusCheck,
  fallback: RuntimeState,
) {
  if (check.name === "lima")
    return check.status === "missing" ? "missing" : "broken";
  if (check.name === "wsl" || check.name === "wsl2")
    return check.status === "unsupported" ? "unsupported" : "broken";
  if (check.name === "vm")
    return check.status === "missing" ? "missing" : fallback;
  if (check.name === "distro" || check.name === "agent")
    return "missing";
  if (check.status === "missing") return "repairable";
  return fallback;
}

function parseManagedRuntimeStatusReport(
  output: string,
): ManagedRuntimeStatusReport | null {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ManagedRuntimeStatusReport;
  } catch {
    return null;
  }
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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  timeoutMs = commandTimeoutMs,
) {
  const commandSpec = executableRuntimeCommand(command, args, env ?? process.env);
  const { stdout } = await execFileAsync(commandSpec.command, commandSpec.args, {
    env,
    shell: false,
    timeout: timeoutMs,
  });
  return stdout;
}

function executableRuntimeCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  if (process.platform !== "win32") return { args, command };
  const script = runtimeToolScript(command, { env, platform: "win32" });
  if (script) {
    return {
      args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
      command: "powershell.exe",
    };
  }
  return {
    args: ["/d", "/s", "/c", commandPromptLine(command, args, env)],
    command: "cmd.exe",
  };
}

function commandPromptLine(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
) {
  return [
    "call",
    commandPromptQuote(windowsBatchCommand(command)),
    ...args.map(commandPromptQuote),
  ].join(" ");
}

function windowsBatchCommand(command: string) {
  if (command === "blame-wsl2-runtime") return "blame-wsl2-runtime.cmd";
  if (command === "blame-lima-runtime") return "blame-lima-runtime.cmd";
  return command;
}

function commandPromptQuote(value: string) {
  return `"${value.replace(/(["^&|<>])/g, "^$1")}"`;
}
