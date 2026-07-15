import type { ProjectInitializationDiagnostics } from "@blame/agent-runtime";
import { createContainerRuntime } from "./container-runtime.ts";
import {
  joinWorkspacePath,
  readFile as readWorkspaceFile,
  resolveWorkspacePath,
} from "./workspace-runtime.ts";

const maxDiagnosticLength = 32_000;
const containerRuntime = createContainerRuntime();

export type CollectProjectInitializationDiagnosticsInput = {
  worktree: string;
  launchError: string;
};

export async function collectProjectInitializationDiagnostics(
  input: CollectProjectInitializationDiagnosticsInput,
  env: NodeJS.ProcessEnv,
): Promise<ProjectInitializationDiagnostics> {
  const worktree = resolveWorkspacePath(input.worktree);
  const composeArgs = [
    "-f",
    joinWorkspacePath(
      worktree,
      ".blame",
      "initialization",
      "docker-compose.yml",
    ),
    "--project-directory",
    worktree,
  ];
  const services = await commandOutput(worktree, env, [
    ...composeArgs,
    "config",
    "--services",
  ]);
  return {
    setupLog: await setupLog(worktree),
    launchError: sanitizeProjectDiagnostic(input.launchError),
    composeConfig: await commandOutput(worktree, env, [
      ...composeArgs,
      "config",
    ]),
    composePs: await commandOutput(worktree, env, [...composeArgs, "ps", "-a"]),
    serviceLogs: await serviceLogOutputs(
      worktree,
      env,
      composeArgs,
      serviceNames(services),
    ),
  };
}

async function serviceLogOutputs(
  worktree: string,
  env: NodeJS.ProcessEnv,
  composeArgs: string[],
  services: string[],
) {
  const entries = await Promise.all(
    services.map(
      async (service) =>
        [
          service,
          await commandOutput(worktree, env, [
            ...composeArgs,
            "logs",
            "--tail",
            "200",
            service,
          ]),
        ] as const,
    ),
  );
  return Object.fromEntries(entries);
}

async function setupLog(worktree: string) {
  try {
    return truncate(
      sanitizeProjectDiagnostic(
        await readWorkspaceFile(
          joinWorkspacePath(worktree, ".blame", "logs", "setup.log"),
        ),
      ),
    );
  } catch (error) {
    return errorText(error);
  }
}

async function commandOutput(
  worktree: string,
  env: NodeJS.ProcessEnv,
  args: string[],
) {
  try {
    const result = await containerRuntime.compose(args, { cwd: worktree, env });
    return truncate(
      sanitizeProjectDiagnostic(
        [result.stdout, result.stderr].filter(Boolean).join("\n"),
      ),
    );
  } catch (error) {
    return truncate(sanitizeProjectDiagnostic(commandErrorText(error)));
  }
}

function serviceNames(output: string) {
  return output
    .split("\n")
    .map((service) => service.trim())
    .filter((service) => /^[a-zA-Z0-9_.-]+$/.test(service));
}

function commandErrorText(error: unknown) {
  if (!error || typeof error !== "object") return errorText(error);
  const value = error as {
    message?: unknown;
    stderr?: unknown;
    stdout?: unknown;
  };
  return [value.message, value.stdout, value.stderr]
    .filter(
      (part): part is string =>
        typeof part === "string" && Boolean(part.trim()),
    )
    .join("\n");
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string) {
  if (value.length <= maxDiagnosticLength) return value;
  return value.slice(value.length - maxDiagnosticLength);
}

export function sanitizeProjectDiagnostic(value: string) {
  return value
    .replace(
      /((?:^|[\s{,])["']?[A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|APP_KEY|CREDENTIAL|COOKIE)[A-Za-z0-9_]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,}\]]+)/gim,
      "$1[REDACTED]",
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}
