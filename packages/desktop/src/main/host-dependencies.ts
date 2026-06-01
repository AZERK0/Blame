import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const commandTimeoutMs = 15_000;
const minimumNodeMajorVersion = 22;

export type HostDependencyName =
  | "git"
  | "docker"
  | "docker-compose"
  | "docker-daemon"
  | "node"
  | "corepack";

export type HostDependencyStatus = "missing" | "unavailable" | "unsupported";

export type HostDependencyIssue = {
  action: string;
  message: string;
  name: HostDependencyName;
  status: HostDependencyStatus;
};

export type HostDependencyReport = {
  issues: HostDependencyIssue[];
  ok: boolean;
};

export type HostDependencyCheckInput = {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  setupScript: string;
};

type CommandRunner = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) => Promise<string>;

type CheckContext = {
  env?: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  run: CommandRunner;
};

export class HostDependencyError extends Error {
  readonly report: HostDependencyReport;

  constructor(report: HostDependencyReport) {
    super(formatHostDependencyReport(report));
    this.name = "HostDependencyError";
    this.report = report;
  }
}

export async function assertHostDependencies(input: HostDependencyCheckInput) {
  const report = await checkHostDependencies(input);
  if (!report.ok) throw new HostDependencyError(report);
  return report;
}

export async function checkHostDependencies(
  input: HostDependencyCheckInput,
  run: CommandRunner = runCommand,
): Promise<HostDependencyReport> {
  const context = {
    env: input.env,
    platform: input.platform ?? process.platform,
    run,
  };
  const issues = await hostDependencyIssues(input.setupScript, context);
  return { issues, ok: issues.length === 0 };
}

export function formatHostDependencyReport(report: HostDependencyReport) {
  if (report.ok) return "Host dependencies are ready.";
  return [
    "Blame cannot prepare this project because host dependencies are missing or unavailable.",
    ...report.issues.map((issue) => `- ${issue.message} ${issue.action}`),
  ].join("\n");
}

export function requiresNodeTooling(setupScript: string) {
  return /\b(?:node|npm|npx|pnpm|yarn|corepack)\b/.test(
    scriptWithoutShellComments(setupScript),
  );
}

export function parseNodeMajorVersion(version: string) {
  const match = version.trim().match(/^v?(\d+)\./);
  return match ? Number(match[1]) : null;
}

async function hostDependencyIssues(
  setupScript: string,
  context: CheckContext,
) {
  const issues: HostDependencyIssue[] = [];
  const dockerIssue = await checkDocker(context);
  if (dockerIssue) issues.push(dockerIssue);
  else issues.push(...(await dockerRuntimeIssues(context)));
  const checks = [checkGit(context)];
  if (requiresNodeTooling(setupScript)) {
    checks.push(checkNode(context), checkCorepack(context));
  }
  issues.push(
    ...(await Promise.all(checks)).filter(
      (issue): issue is HostDependencyIssue => Boolean(issue),
    ),
  );
  return issues;
}

async function dockerRuntimeIssues(context: CheckContext) {
  return (
    await Promise.all([checkDockerCompose(context), checkDockerDaemon(context)])
  ).filter((issue): issue is HostDependencyIssue => Boolean(issue));
}

async function checkGit(context: CheckContext) {
  return missingToolIssue(context, "git", ["--version"], "git");
}

async function checkDocker(context: CheckContext) {
  return missingToolIssue(context, "docker", ["--version"], "docker");
}

async function checkDockerCompose(context: CheckContext) {
  return missingToolIssue(
    context,
    "docker",
    ["compose", "version"],
    "docker-compose",
  );
}

async function checkDockerDaemon(context: CheckContext) {
  try {
    await context.run("docker", ["info"], context.env);
    return null;
  } catch {
    return hostDependencyIssue(
      context.platform,
      "docker-daemon",
      "unavailable",
    );
  }
}

async function checkNode(context: CheckContext) {
  try {
    const version = await context.run("node", ["--version"], context.env);
    const major = parseNodeMajorVersion(version);
    if (major === null || major < minimumNodeMajorVersion) {
      return hostDependencyIssue(context.platform, "node", "unsupported");
    }
    return null;
  } catch {
    return hostDependencyIssue(context.platform, "node", "missing");
  }
}

async function checkCorepack(context: CheckContext) {
  return missingToolIssue(context, "corepack", ["--version"], "corepack");
}

async function missingToolIssue(
  context: CheckContext,
  command: string,
  args: string[],
  name: HostDependencyName,
) {
  try {
    await context.run(command, args, context.env);
    return null;
  } catch {
    return hostDependencyIssue(context.platform, name, "missing");
  }
}

function hostDependencyIssue(
  platform: NodeJS.Platform,
  name: HostDependencyName,
  status: HostDependencyStatus,
): HostDependencyIssue {
  return {
    action: hostDependencyAction(platform, name, status),
    message: hostDependencyMessage(name, status),
    name,
    status,
  };
}

function hostDependencyMessage(
  name: HostDependencyName,
  status: HostDependencyStatus,
) {
  if (name === "docker-daemon") return "Docker is installed but not running.";
  if (name === "docker-compose") return "Docker Compose is not available.";
  if (name === "node" && status === "unsupported")
    return "Node.js 22 or newer is required for this setup script.";
  return `${hostDependencyLabel(name)} is not available.`;
}

function hostDependencyAction(
  platform: NodeJS.Platform,
  name: HostDependencyName,
  status: HostDependencyStatus,
) {
  if (platform === "darwin") return macHostDependencyAction(name, status);
  if (platform === "win32") return windowsHostDependencyAction(name, status);
  return linuxHostDependencyAction(name, status);
}

function macHostDependencyAction(
  name: HostDependencyName,
  status: HostDependencyStatus,
) {
  if (name === "git")
    return "Install Xcode Command Line Tools or run brew install git.";
  if (name.startsWith("docker"))
    return "Install and start Docker Desktop for Mac.";
  if (name === "corepack")
    return "Install Node.js 22 or newer, then run corepack --version.";
  return status === "unsupported"
    ? "Upgrade Node.js with nvm, fnm, or the official installer."
    : "Install Node.js 22 or newer with nvm, fnm, or the official installer.";
}

function windowsHostDependencyAction(
  name: HostDependencyName,
  status: HostDependencyStatus,
) {
  if (name === "git")
    return "Install Git for Windows or run winget install Git.Git.";
  if (name.startsWith("docker"))
    return "Install and start Docker Desktop with WSL2 enabled.";
  if (name === "corepack")
    return "Install Node.js 22 or newer, then run corepack --version.";
  return status === "unsupported"
    ? "Upgrade Node.js with winget install OpenJS.NodeJS.LTS."
    : "Install Node.js with winget install OpenJS.NodeJS.LTS.";
}

function linuxHostDependencyAction(
  name: HostDependencyName,
  status: HostDependencyStatus,
) {
  if (name === "git") return "Install git with your system package manager.";
  if (name.startsWith("docker"))
    return "Install Docker Engine, the Compose plugin, and ensure the daemon is reachable.";
  if (name === "corepack")
    return "Install Node.js 22 or newer, then run corepack --version.";
  return status === "unsupported"
    ? "Upgrade Node.js with your system package manager, nvm, or fnm."
    : "Install Node.js 22 or newer with your system package manager, nvm, or fnm.";
}

function hostDependencyLabel(name: HostDependencyName) {
  const labels: Record<HostDependencyName, string> = {
    corepack: "Corepack",
    docker: "Docker",
    "docker-compose": "Docker Compose",
    "docker-daemon": "Docker daemon",
    git: "Git",
    node: "Node.js",
  };
  return labels[name];
}

function scriptWithoutShellComments(setupScript: string) {
  return setupScript
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
}

async function runCommand(
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
) {
  const { stdout } = await execFileAsync(command, args, {
    env,
    timeout: commandTimeoutMs,
  });
  return stdout;
}
