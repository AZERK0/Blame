import { existsSync, readdirSync } from "node:fs";
import { delimiter, dirname, join, win32 } from "node:path";

type SetupPathInput = {
  env?: NodeJS.ProcessEnv;
  execPath?: string;
  platform?: NodeJS.Platform;
};

export function setupPath(input: SetupPathInput = {}) {
  const env = input.env ?? process.env;
  const platform = input.platform ?? process.platform;
  const execPath = input.execPath ?? process.execPath;
  const execDir = dirnameForPlatform(execPath, platform);
  return uniquePaths([
    execDir,
    ...runtimeToolPaths(execDir, platform),
    ...windowsRuntimeToolPaths(env, execDir, platform),
    ...windowsPackageManagerPaths(env, platform),
    ...nodeVersionManagerPaths(env),
    env.PATH,
  ], platform).join(pathDelimiter(platform));
}

function runtimeToolPaths(execDir: string, platform: NodeJS.Platform) {
  if (platform !== "darwin") return [];
  return [
    join(dirname(execDir), "Resources", "runtime", "macos", "bin"),
    join(execDir, "resources", "runtime", "macos", "bin"),
    join(execDir, "runtime", "macos", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
}

function windowsRuntimeToolPaths(
  env: NodeJS.ProcessEnv,
  execDir: string,
  platform: NodeJS.Platform,
) {
  if (platform !== "win32") return [];
  return [
    env.BLAME_RUNTIME_BIN_DIR,
    win32.join(execDir, "resources", "runtime", "windows", "bin"),
    win32.join(execDir, "runtime", "windows", "bin"),
  ];
}

function dirnameForPlatform(path: string, platform: NodeJS.Platform) {
  return platform === "win32" ? win32.dirname(path) : dirname(path);
}

function windowsPackageManagerPaths(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
) {
  if (platform !== "win32") return [];
  return [
    env.APPDATA ? win32.join(env.APPDATA, "npm") : undefined,
    env.LOCALAPPDATA
      ? win32.join(env.LOCALAPPDATA, "pnpm")
      : undefined,
    env.ProgramFiles ? win32.join(env.ProgramFiles, "nodejs") : undefined,
    env["ProgramFiles(x86)"]
      ? win32.join(env["ProgramFiles(x86)"], "nodejs")
      : undefined,
  ];
}

function nodeVersionManagerPaths(env: NodeJS.ProcessEnv) {
  return [
    ...nodeVersionBins(join(homePath(env), ".nvm", "versions", "node")),
    ...nodeVersionBins(
      join(homePath(env), ".local", "share", "fnm", "node-versions"),
    ),
    join(homePath(env), ".local", "bin"),
    join(homePath(env), ".bun", "bin"),
  ];
}

function nodeVersionBins(root: string) {
  try {
    return readdirSync(root)
      .map((entry) => join(root, entry, "bin"))
      .filter((path) => existsSync(path));
  } catch {
    return [];
  }
}

function homePath(env: NodeJS.ProcessEnv) {
  return env.HOME || env.USERPROFILE || "";
}

function uniquePaths(
  paths: Array<string | undefined>,
  platform: NodeJS.Platform,
) {
  const separator = pathDelimiter(platform);
  return Array.from(
    new Set(paths.flatMap((path) => (path ? path.split(separator) : []))),
  ).filter(Boolean);
}

function pathDelimiter(platform: NodeJS.Platform) {
  return platform === "win32" ? ";" : delimiter;
}
