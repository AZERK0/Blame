import { withoutTelemetryEnvironment } from "@blame/telemetry";
import type { SemanticWorkspaceExecutionRequest } from "@blame/agent-runtime";
import { shell } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AgentHostMethod } from "./agent-runtime-process-protocol.ts";
import { getPreviewDevtoolsTarget } from "./preview-browser-ipc.ts";
import { previewLogService } from "./preview-runtime/preview-log-service.ts";
import { runtimeAgentClient, runtimeAgentSupported } from "./runtime-agent.ts";
import { semanticWorkspaceExecutionTarget } from "./semantic-workspace-routing.ts";
import {
  ensureRuntimeGitUserIdentity,
  getRuntimeGitIdentity,
  run as runRuntime,
  runtimeManagedPath,
} from "./workspace-runtime.ts";

const execFileAsync = promisify(execFile);

export async function handleAgentHostRequest(
  method: AgentHostMethod,
  input: unknown,
  signal: AbortSignal,
) {
  if (method === "git") return agentGit(input);
  if (method === "openExternalUrl") return openAgentExternalUrl(input);
  if (method === "previewDevtools") {
    return getPreviewDevtoolsTarget(input as never);
  }
  if (method === "previewContainerLogs") {
    return previewLogService.read(input as never);
  }
  if (method === "semanticWorkspace") {
    return agentSemanticWorkspace(input, signal);
  }
  throw new Error(`Unsupported agent host method: ${method}`);
}

async function agentSemanticWorkspace(input: unknown, signal: AbortSignal) {
  const request = input as SemanticWorkspaceExecutionRequest;
  if (
    !runtimeAgentSupported() ||
    !request ||
    typeof request !== "object" ||
    typeof request.workspaceRoot !== "string" ||
    semanticWorkspaceExecutionTarget(request) !== "managed-runtime"
  ) {
    throw new Error("Invalid managed semantic workspace request");
  }
  return runtimeAgentClient().semanticWorkspace(request, signal);
}

async function agentGit(input: unknown) {
  const request = recordInput(input);
  const cwd = request.cwd;
  const args = request.args;
  if (typeof cwd !== "string" || !stringArray(args)) {
    throw new Error("Invalid agent Git request");
  }
  if (runtimeManagedPath(cwd)) return runtimeManagedGit(cwd, args);
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: withoutTelemetryEnvironment(process.env),
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout;
}

async function runtimeManagedGit(cwd: string, args: string[]) {
  await ensureRuntimeGitUserIdentity();
  const { name, email } = getRuntimeGitIdentity();
  const { stdout } = await runRuntime("git", args, {
    cwd,
    env: runtimeGitEnvironment(name, email),
  });
  return stdout;
}

function runtimeGitEnvironment(name?: string, email?: string) {
  return {
    ...withoutTelemetryEnvironment(process.env),
    ...gitIdentityEnvironment(name, email),
    GIT_TERMINAL_PROMPT: "0",
    GIT_SSH_COMMAND: gitSshCommand(),
  };
}

function gitIdentityEnvironment(name?: string, email?: string) {
  return {
    ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
    ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
  };
}

function gitSshCommand() {
  return process.platform === "win32"
    ? "ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=no"
    : "ssh -o BatchMode=yes -o StrictHostKeyChecking=no";
}

function openAgentExternalUrl(input: unknown) {
  const value = recordInput(input).url;
  if (typeof value !== "string") throw new Error("Invalid external URL");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Invalid external URL");
  }
  void shell.openExternal(url.toString());
  return true;
}

function recordInput(input: unknown) {
  if (!input || typeof input !== "object") return {};
  return input as Record<string, unknown>;
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
