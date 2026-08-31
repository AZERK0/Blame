import { existsSync } from "node:fs";
import { win32 } from "node:path";

type SetupShellInput = {
  env?: NodeJS.ProcessEnv;
  pathExists?: (path: string) => boolean;
  platform?: NodeJS.Platform;
};

export function setupShellCommand(
  scriptPath: string,
  input: SetupShellInput = {},
) {
  const platform = input.platform ?? process.platform;
  return {
    args: [setupScriptPath(scriptPath, platform)],
    command: resolveSetupBash({ ...input, platform }),
  };
}

export function resolveSetupBash(input: SetupShellInput = {}) {
  const platform = input.platform ?? process.platform;
  if (platform !== "win32") return "bash";
  const env = input.env ?? process.env;
  const pathExists = input.pathExists ?? existsSync;
  const configuredPath = env.BLAME_BASH_PATH?.trim();
  if (configuredPath && pathExists(configuredPath)) return configuredPath;
  return (
    windowsGitBashCandidates(env).find((path) => pathExists(path)) ?? "bash"
  );
}

function windowsGitBashCandidates(env: NodeJS.ProcessEnv) {
  return [
    env.ProgramFiles,
    env["ProgramFiles(x86)"],
    env.LOCALAPPDATA ? win32.join(env.LOCALAPPDATA, "Programs") : undefined,
  ]
    .filter((path): path is string => Boolean(path))
    .flatMap((root) => [
      win32.join(root, "Git", "bin", "bash.exe"),
      win32.join(root, "Git", "usr", "bin", "bash.exe"),
    ]);
}

function setupScriptPath(scriptPath: string, platform: NodeJS.Platform) {
  if (platform !== "win32") return scriptPath;
  return scriptPath.replace(/\\/g, "/");
}
