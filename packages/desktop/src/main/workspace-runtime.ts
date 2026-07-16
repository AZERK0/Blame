import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { withoutTelemetryEnvironment } from "@blame/telemetry";
import { existsSync } from "node:fs";
import {
  appendFile as appendHostFile,
  chmod as chmodHost,
  mkdir as mkdirHost,
  readdir as readdirHost,
  readFile as readHostFile,
  rename as renameHost,
  rm as rmHost,
  writeFile as writeHostFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, posix, resolve, win32 } from "node:path";
import { promisify } from "node:util";
import { runtimeToolScript, setupPath } from "./host-tool-path.ts";
import { runtimeAgentClient, runtimeAgentSupported } from "./runtime-agent.ts";
import log from "electron-log";

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

const execFileAsync = promisify(execFile);
const vmRuntimeWorktreeRoot =
  "/home/blame/.local/share/blame/runtime/worktrees";
const macosRuntimeWorktreeSegment =
  "/Library/Application Support/Blame/runtime/worktrees";
const ignoredProjectSearchDirectories = [
  ".blame",
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".venv",
  "__pycache__",
  "coverage",
  "node_modules",
  "site-packages",
  "venv",
];
const maxProjectFileSearchResults = 30_000;

type RuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  user?: "blame" | "root";
};

type RuntimeCommandSpec = {
  args: string[];
  command: string;
  cwd?: string;
};

export function worktreeRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  return platformWorktreeRoot(platform, env);
}

export function worktreePath(input: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  repositoryRoot: string;
  storyId: string;
  title: string;
}) {
  const repositoryName = repositoryBasename(
    input.repositoryRoot,
    input.platform ?? process.platform,
  );
  const slug = storySlug(input.storyId, input.title);
  return posix.join(
    platformWorktreeRoot(input.platform, input.env),
    repositoryName,
    `story-${input.storyId}-${slug}`,
  );
}

export function storyBranch(storyId: string, title: string) {
  return `blame/story-${storyId}-${storySlug(storyId, title)}`;
}

export function storySlug(storyId: string, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `story-${storyId}`;
}

export function runtimeManagedPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "darwin" && platform !== "win32") return false;
  if (platform === "darwin") return macosRuntimeManagedPath(path);
  return (
    normalizedRuntimePath(path) === vmRuntimeWorktreeRoot ||
    normalizedRuntimePath(path).startsWith(`${vmRuntimeWorktreeRoot}/`)
  );
}

export function resolveWorkspacePath(path: string) {
  if (runtimePathLike(path)) return normalizedRuntimePath(path);
  return resolve(path);
}

export function joinWorkspacePath(root: string, ...paths: string[]) {
  if (runtimePathLike(root))
    return posix.join(normalizedRuntimePath(root), ...paths);
  return joinHostPath(root, ...paths);
}

export function dirnameWorkspacePath(path: string) {
  if (runtimePathLike(path)) return posix.dirname(normalizedRuntimePath(path));
  return dirname(path);
}

export function runtimeAccessiblePath(
  path: string,
  platform: NodeJS.Platform = process.platform,
) {
  return runtimeCwdPath(path, platform);
}

export function runtimeHostPath(
  path: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== "win32" || !runtimeManagedPath(path, platform)) return path;
  const normalized = normalizedRuntimePath(path).replace(/^\/+/, "");
  return `\\\\wsl.localhost\\BlameRuntime\\${normalized.replace(/\//g, "\\")}`;
}

export function runtimeCommand(
  command: string,
  args: string[],
  input: RuntimeOptions = {},
): RuntimeCommandSpec {
  const platform = input.platform ?? process.platform;
  if (platform === "darwin")
    return runtimeWrappedCommand(
      "blame-lima-runtime",
      command,
      args,
      input.cwd,
      platform,
      input.user,
    );
  if (platform === "win32")
    return runtimeWrappedCommand(
      "blame-wsl2-runtime",
      command,
      args,
      input.cwd,
      platform,
      input.user,
    );
  return { args, command, cwd: input.cwd };
}

export async function run(
  command: string,
  args: string[],
  input: RuntimeOptions = {},
) {
  const platform = input.platform ?? process.platform;
  let env = runtimeEnvironment(input, platform);
  const useAgent = useRuntimeAgent(platform, env);
  if (command === "git" && useAgent) {
    const { name, email } = getRuntimeGitIdentity();
    env = {
      ...env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_SSH_COMMAND:
        platform === "win32"
          ? "ssh.exe -o BatchMode=yes -o StrictHostKeyChecking=no"
          : "ssh -o BatchMode=yes -o StrictHostKeyChecking=no",
      ...(name ? { GIT_AUTHOR_NAME: name, GIT_COMMITTER_NAME: name } : {}),
      ...(email ? { GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_EMAIL: email } : {}),
    };
  }
  if (useAgent) {
    try {
      return await runtimeAgentClient({ env, platform }).exec({
        args,
        command,
        cwd: input.cwd ? runtimeCwdPath(input.cwd, platform) : undefined,
        env,
        user: input.user ?? "blame",
      });
    } catch (error) {
      if (runtimeAgentCommandFailed(error)) throw error;
    }
  }
  const spec = runtimeCommand(command, args, input);
  const commandSpec = runtimeExecutableCommand(spec, platform, env);
  const result = await execFileAsync(commandSpec.command, commandSpec.args, {
    cwd: spec.cwd,
    env,
    shell: false,
  });
  return {
    stderr: String(result.stderr),
    stdout: String(result.stdout),
  };
}

export function spawnRuntime(
  command: string,
  args: string[],
  input: RuntimeOptions = {},
): ChildProcessWithoutNullStreams {
  const platform = input.platform ?? process.platform;
  const env = runtimeEnvironment(input, platform);
  if (useRuntimeAgent(platform, env)) {
    return runtimeAgentClient({ env, platform }).spawn({
      args,
      command,
      cwd: input.cwd ? runtimeCwdPath(input.cwd, platform) : undefined,
      env,
      user: input.user ?? "blame",
    });
  }
  const spec = runtimeCommand(command, args, input);
  const commandSpec = runtimeExecutableCommand(spec, platform, env);
  return spawn(commandSpec.command, commandSpec.args, {
    cwd: spec.cwd,
    detached: platform !== "win32",
    env,
    shell: false,
  });
}

export async function pathExists(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) return existsSync(path);
  try {
    await run("test", ["-e", path], input);
    return true;
  } catch {
    return false;
  }
}

export async function mkdir(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) {
    await mkdirHost(path, { recursive: true });
    return;
  }
  await run("mkdir", ["-p", path], input);
}

export async function rm(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform)) {
    await rmHost(path, { force: true, recursive: true });
    return;
  }
  await run("rm", ["-rf", path], { ...input, user: "root" });
}

export async function readFile(path: string, input: RuntimeOptions = {}) {
  if (!runtimeManagedPath(path, input.platform))
    return readHostFile(path, "utf8");
  const { stdout } = await run("cat", [path], input);
  return stdout;
}

export async function readExistingFiles(
  paths: string[],
  input: RuntimeOptions = {},
) {
  const platform = input.platform ?? process.platform;
  const env = runtimeEnvironment(input, platform);
  if (
    paths.every((path) => runtimeManagedPath(path, platform)) &&
    useRuntimeAgent(platform, env)
  ) {
    try {
      return (
        await runtimeAgentClient({ env, platform }).readExistingFiles(paths)
      ).files;
    } catch (error) {
      if (runtimeAgentCommandFailed(error)) throw error;
    }
  }
  const entries = await Promise.all(
    paths.map(async (path) => {
      if (!(await pathExists(path, input))) return [path, null] as const;
      return [path, await readFile(path, input)] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export async function readDirectory(path: string, input: RuntimeOptions = {}) {
  const { stdout } = await run(
    "find",
    [path, "-mindepth", "1", "-maxdepth", "1", "-printf", "%f\t%y\n"],
    input,
  );
  return stdout
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, type] = line.split("\t", 2);
      return {
        isDirectory: () => type === "d",
        isFile: () => type === "f",
        isSymbolicLink: () => type === "l",
        name,
      };
    });
}

export async function findProjectFilesByName(
  root: string,
  name: string,
  fns: {
    run: (command: string, args: string[]) => Promise<{ stdout: string }>;
  } = { run },
) {
  if (!name || name.includes("/") || name.includes("\\")) return [];
  try {
    const { stdout } = await fns.run(
      "find",
      projectFileSearchArguments(root, name),
    );
    return [...new Set(stdout.split("\n").filter(Boolean))].slice(
      0,
      maxProjectFileSearchResults,
    );
  } catch {
    return [];
  }
}

function projectFileSearchArguments(root: string, name: string) {
  const ignoredNames = ignoredProjectSearchDirectories.flatMap(
    (directory, index) =>
      index ? ["-o", "-name", directory] : ["-name", directory],
  );
  return [
    root,
    "-type",
    "d",
    "(",
    ...ignoredNames,
    ")",
    "-prune",
    "-o",
    "-type",
    "f",
    "-name",
    name,
    "-print",
  ];
}

export async function writeFile(
  path: string,
  data: string,
  input: RuntimeOptions = {},
) {
  if (!runtimeManagedPath(path, input.platform)) {
    await writeHostFile(path, data, "utf8");
    return;
  }
  await mkdir(dirname(path), input);
  const encoded = Buffer.from(data, "utf8").toString("base64");
  await run(
    "sh",
    [
      "-lc",
      `printf %s ${shellQuote(encoded)} | base64 -d > ${shellQuote(path)}`,
    ],
    input,
  );
}

export async function writeFileAtomic(
  path: string,
  data: string,
  input: RuntimeOptions = {},
) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, data, input);
    if (runtimeManagedPath(path, input.platform)) {
      await run("mv", ["--", temporaryPath, path], input);
      return;
    }
    await renameHost(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, input).catch(() => undefined);
    throw error;
  }
}

export async function appendFile(
  path: string,
  data: string,
  input: RuntimeOptions = {},
) {
  if (!runtimeManagedPath(path, input.platform)) {
    await appendHostFile(path, data, "utf8");
    return;
  }
  await mkdir(dirname(path), input);
  const encoded = Buffer.from(data, "utf8").toString("base64");
  await run(
    "sh",
    [
      "-lc",
      `printf %s ${shellQuote(encoded)} | base64 -d >> ${shellQuote(path)}`,
    ],
    input,
  );
}

export async function chmod(
  path: string,
  mode: number,
  input: RuntimeOptions = {},
) {
  if (!runtimeManagedPath(path, input.platform)) {
    await chmodHost(path, mode);
    return;
  }
  await run("chmod", [mode.toString(8), path], input);
}

function runtimeWrappedCommand(
  wrapper: string,
  command: string,
  args: string[],
  cwd?: string,
  platform: NodeJS.Platform = process.platform,
  user: RuntimeOptions["user"] = "blame",
): RuntimeCommandSpec {
  const commandArgs =
    user === "root" ? ["root", command, ...args] : [command, ...args];
  if (!cwd) return { args: commandArgs, command: wrapper };
  const runtimeCwd = runtimeCwdPath(cwd, platform);
  const script = `cd ${shellQuote(runtimeCwd)} && exec ${shellQuote(command)} ${args.map(shellQuote).join(" ")}`;
  return {
    args:
      user === "root" ? ["root", "sh", "-lc", script] : ["sh", "-lc", script],
    command: wrapper,
  };
}

function runtimeCwdPath(path: string, platform: NodeJS.Platform) {
  if (platform !== "win32" || runtimePathLike(path)) return path;
  return windowsPathToWslPath(path) ?? path;
}

function windowsPathToWslPath(path: string) {
  const normalized = path.replace(/\//g, "\\");
  const match = normalized.match(/^([a-zA-Z]):\\?(.*)$/);
  if (!match) return undefined;
  const drive = match[1].toLowerCase();
  const rest = match[2].split("\\").filter(Boolean).map(encodeWslSegment);
  return posix.join("/mnt", drive, ...rest);
}

function encodeWslSegment(value: string) {
  return value;
}

function runtimeEnvironment(input: RuntimeOptions, platform: NodeJS.Platform) {
  const env = withoutTelemetryEnvironment(
    input.env ?? {
      ...process.env,
      PATH: setupPath({ platform }),
    },
  );
  if (platform === "win32") {
    const wslenv =
      "GIT_SSH_COMMAND/u:GIT_TERMINAL_PROMPT/u:GIT_AUTHOR_NAME/u:GIT_AUTHOR_EMAIL/u:GIT_COMMITTER_NAME/u:GIT_COMMITTER_EMAIL/u";
    return {
      ...env,
      WSLENV: env.WSLENV ? `${env.WSLENV}:${wslenv}` : wslenv,
    };
  }
  return env;
}

function useRuntimeAgent(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  return (
    runtimeAgentSupported(platform) && env.BLAME_DISABLE_RUNTIME_AGENT !== "1"
  );
}

function runtimeAgentCommandFailed(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    (error as { runtimeAgentCommandFailed?: boolean })
      .runtimeAgentCommandFailed,
  );
}

export function runtimeExecutableCommand(
  spec: RuntimeCommandSpec,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
) {
  if (platform !== "win32") return spec;
  const script = runtimeToolScript(spec.command, { env, platform });
  if (script) {
    return {
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        ...spec.args,
      ],
      command: "powershell.exe",
    };
  }
  return {
    args: ["/d", "/s", "/c", commandPromptLine(spec.command, spec.args, env)],
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

function repositoryBasename(path: string, platform: NodeJS.Platform) {
  if (platform === "win32") return win32.basename(path);
  return basename(path);
}

function joinHostPath(root: string, ...paths: string[]) {
  return join(root, ...paths);
}

function platformWorktreeRoot(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (platform === "win32") return vmRuntimeWorktreeRoot;
  if (platform === "darwin") return macosHostWorktreeRoot(env);
  const home = env.HOME || homedir() || "/home/blame";
  return posix.join(
    home.replace(/\\/g, "/"),
    ".local",
    "share",
    "blame",
    "runtime",
    "worktrees",
  );
}

function macosHostWorktreeRoot(env: NodeJS.ProcessEnv = process.env) {
  const home = env.HOME || homedir() || "/Users/blame";
  return posix.join(
    home.replace(/\\/g, "/"),
    "Library",
    "Application Support",
    "Blame",
    "runtime",
    "worktrees",
  );
}

function macosRuntimeManagedPath(path: string) {
  const normalized = normalizedRuntimePath(path);
  return (
    normalized === vmRuntimeWorktreeRoot ||
    normalized.startsWith(`${vmRuntimeWorktreeRoot}/`) ||
    normalized.endsWith(macosRuntimeWorktreeSegment) ||
    normalized.includes(`${macosRuntimeWorktreeSegment}/`)
  );
}

function runtimePathLike(path: string) {
  const normalized = normalizedRuntimePath(path);
  return (
    normalized === vmRuntimeWorktreeRoot ||
    normalized.startsWith(`${vmRuntimeWorktreeRoot}/`) ||
    normalized.endsWith(macosRuntimeWorktreeSegment) ||
    normalized.includes(`${macosRuntimeWorktreeSegment}/`) ||
    normalized.includes("/.local/share/blame/runtime/worktrees/")
  );
}

function normalizedRuntimePath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/g, "");
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export async function hasMissingWorkspaceNodeModules(
  worktree: string,
  fns = {
    run,
    readFile,
    pathExists,
    dirnameWorkspacePath,
    joinWorkspacePath,
  },
): Promise<boolean> {
  try {
    const { stdout } = await fns.run("find", [
      worktree,
      "-type",
      "d",
      "(",
      "-name",
      "node_modules",
      "-o",
      "-name",
      ".git",
      "-o",
      "-name",
      ".next",
      "-o",
      "-name",
      ".nuxt",
      "-o",
      "-name",
      ".svelte-kit",
      "-o",
      "-name",
      "dist",
      "-o",
      "-name",
      "build",
      "-o",
      "-name",
      "out",
      ")",
      "-prune",
      "-o",
      "-name",
      "package.json",
      "-print",
    ]);

    const packageJsonPaths = stdout.split("\n").filter(Boolean);
    for (const pkgPath of packageJsonPaths) {
      const dir = fns.dirnameWorkspacePath(pkgPath);
      if (dir === worktree) {
        continue;
      }
      try {
        const content = await fns.readFile(pkgPath);
        const pkg = JSON.parse(content);
        const hasDeps = Boolean(
          (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) ||
          (pkg.devDependencies &&
            Object.keys(pkg.devDependencies).length > 0) ||
          (pkg.peerDependencies &&
            Object.keys(pkg.peerDependencies).length > 0) ||
          (pkg.optionalDependencies &&
            Object.keys(pkg.optionalDependencies).length > 0),
        );

        if (hasDeps) {
          const nodeModulesPath = fns.joinWorkspacePath(dir, "node_modules");
          if (!(await fns.pathExists(nodeModulesPath))) {
            return true;
          }
        }
      } catch {
        // If we fail to read or parse a specific package.json, skip it
      }
    }
  } catch {
    // If find command fails, we assume no missing workspace node_modules
  }
  return false;
}

async function findPnpmWorkspaceYamlFilesHost(
  dir: string,
  readdirFn = readdirHost,
): Promise<string[]> {
  const result: string[] = [];
  const queue = [dir];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    try {
      const entries = await readdirFn(curr, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(curr, entry.name);
        if (entry.isDirectory()) {
          const name = entry.name;
          if (
            name.startsWith(".") ||
            name === "node_modules" ||
            name === "dist" ||
            name === "build" ||
            name === "out"
          ) {
            continue;
          }
          queue.push(fullPath);
        } else if (entry.isFile() && entry.name === "pnpm-workspace.yaml") {
          result.push(fullPath);
        }
      }
    } catch {
      // Ignore reading errors
    }
  }
  return result;
}

async function findDuplicateLockFilesHost(
  dir: string,
  lockfileNames: string[],
  readdirFn = readdirHost,
): Promise<string[]> {
  const result: string[] = [];
  const queue = [dir];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    try {
      const entries = await readdirFn(curr, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(curr, entry.name);
        if (entry.isDirectory()) {
          const name = entry.name;
          if (
            name.startsWith(".") ||
            name === "node_modules" ||
            name === "dist" ||
            name === "build" ||
            name === "out"
          ) {
            continue;
          }
          queue.push(fullPath);
        } else if (entry.isFile() && lockfileNames.includes(entry.name)) {
          if (curr !== dir) {
            result.push(fullPath);
          }
        }
      }
    } catch {
      // Ignore reading errors
    }
  }
  return result;
}

export async function sanitizeWorkspaceConfigFiles(
  worktree: string,
  fns = {
    run,
    readFile,
    writeFile,
    pathExists,
    joinWorkspacePath,
    rm,
    readdirHost,
    platform: process.platform,
  },
): Promise<void> {
  try {
    const platform = fns.platform;
    let paths: string[] = [];
    if (!runtimeManagedPath(worktree, platform)) {
      paths = await findPnpmWorkspaceYamlFilesHost(worktree, fns.readdirHost);
    } else {
      const { stdout } = await fns.run("find", [
        worktree,
        "-type",
        "f",
        "-name",
        "pnpm-workspace.yaml",
      ]);
      paths = stdout.split("\n").filter(Boolean);
    }
    const rootConfigPath = fns.joinWorkspacePath(
      worktree,
      "pnpm-workspace.yaml",
    );

    for (const configPath of paths) {
      if (configPath === rootConfigPath) {
        continue;
      }
      try {
        if (await fns.pathExists(rootConfigPath)) {
          const subContent = await fns.readFile(configPath);
          const subYaml = parseYaml(subContent);

          if (
            subYaml &&
            (subYaml.allowBuilds || subYaml.ignoredBuiltDependencies)
          ) {
            const rootContent = await fns.readFile(rootConfigPath);
            const rootYaml = parseYaml(rootContent) || {};

            let changed = false;
            if (subYaml.allowBuilds) {
              rootYaml.allowBuilds = {
                ...(rootYaml.allowBuilds || {}),
                ...subYaml.allowBuilds,
              };
              changed = true;
            }
            if (subYaml.ignoredBuiltDependencies) {
              const rootIgnored = new Set(
                rootYaml.ignoredBuiltDependencies || [],
              );
              for (const dep of subYaml.ignoredBuiltDependencies) {
                rootIgnored.add(dep);
              }
              rootYaml.ignoredBuiltDependencies = Array.from(rootIgnored);
              changed = true;
            }

            if (changed) {
              await fns.writeFile(rootConfigPath, stringifyYaml(rootYaml));
            }
          }
        }
      } catch {
        // If merge fails, proceed to delete to make Turbopack work
      }

      try {
        await fns.rm(configPath);
      } catch {
        // Ignore deletion failure
      }
    }

    // Now, sanitize duplicate lockfiles
    let lockfilePaths: string[] = [];
    const lockfileNames = [
      "pnpm-lock.yaml",
      "package-lock.json",
      "yarn.lock",
      "bun.lock",
      "bun.lockb",
    ];
    if (!runtimeManagedPath(worktree, platform)) {
      lockfilePaths = await findDuplicateLockFilesHost(
        worktree,
        lockfileNames,
        fns.readdirHost,
      );
    } else {
      for (const name of lockfileNames) {
        try {
          const { stdout } = await fns.run("find", [
            worktree,
            "-type",
            "f",
            "-name",
            name,
          ]);
          const found = stdout.split("\n").filter(Boolean);
          for (const p of found) {
            const rootLockPath = fns.joinWorkspacePath(worktree, name);
            if (p !== rootLockPath) {
              lockfilePaths.push(p);
            }
          }
        } catch {
          // Ignore find errors
        }
      }
    }

    for (const lockPath of lockfilePaths) {
      try {
        await fns.rm(lockPath);
      } catch {
        // Ignore deletion failure
      }
    }
  } catch {
    // Ignore overall failure
  }
}

let runtimeGitIdentityConfigured = false;
let resolvedGitName = "";
let resolvedGitEmail = "";

export function getRuntimeGitIdentity() {
  return { name: resolvedGitName, email: resolvedGitEmail };
}

export function resetRuntimeGitIdentityConfigured() {
  runtimeGitIdentityConfigured = false;
  resolvedGitName = "";
  resolvedGitEmail = "";
}

export const resetRuntimeGitIdentityConfiguredForTesting =
  resetRuntimeGitIdentityConfigured;

export async function ensureRuntimeGitUserIdentity(
  fns = {
    execFileAsync,
    run,
  },
) {
  if (runtimeGitIdentityConfigured) return;
  try {
    let name = "";
    let email = "";
    try {
      const { stdout } = await fns.execFileAsync("git", [
        "config",
        "--global",
        "user.name",
      ]);
      name = stdout.trim();
    } catch (err) {
      log.warn(
        "ensureRuntimeGitUserIdentity: failed to read host global user.name:",
        err,
      );
    }
    if (!name) {
      try {
        const { stdout } = await fns.execFileAsync("git", [
          "config",
          "user.name",
        ]);
        name = stdout.trim();
      } catch (err) {
        log.warn(
          "ensureRuntimeGitUserIdentity: failed to read host local user.name:",
          err,
        );
      }
    }
    if (!name) {
      name =
        process.env.GIT_AUTHOR_NAME ||
        process.env.GIT_COMMITTER_NAME ||
        process.env.USER ||
        process.env.USERNAME ||
        "Blame User";
    }

    try {
      const { stdout } = await fns.execFileAsync("git", [
        "config",
        "--global",
        "user.email",
      ]);
      email = stdout.trim();
    } catch (err) {
      log.warn(
        "ensureRuntimeGitUserIdentity: failed to read host global user.email:",
        err,
      );
    }
    if (!email) {
      try {
        const { stdout } = await fns.execFileAsync("git", [
          "config",
          "user.email",
        ]);
        email = stdout.trim();
      } catch (err) {
        log.warn(
          "ensureRuntimeGitUserIdentity: failed to read host local user.email:",
          err,
        );
      }
    }
    if (!email) {
      email =
        process.env.GIT_AUTHOR_EMAIL ||
        process.env.GIT_COMMITTER_EMAIL ||
        "blame@example.local";
    }

    log.info(
      `ensureRuntimeGitUserIdentity: configuring VM git identity: ${name} <${email}>`,
    );
    await fns.run("git", ["config", "--global", "user.name", name]);
    await fns.run("git", ["config", "--global", "user.email", email]);

    resolvedGitName = name;
    resolvedGitEmail = email;
    runtimeGitIdentityConfigured = true;
    log.info(
      "ensureRuntimeGitUserIdentity: VM git identity configured successfully.",
    );
  } catch (err) {
    log.error(
      "ensureRuntimeGitUserIdentity: failed to configure VM git identity:",
      err,
    );
  }
}
