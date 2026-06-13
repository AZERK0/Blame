import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ContainerRuntimeCommand =
  | "compose"
  | "container"
  | "info"
  | "inspect"
  | "network"
  | "volume";

export type ContainerRuntimeExecOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
};

export type ContainerRuntimeResult = {
  stdout: string;
  stderr: string;
};

type RuntimeCommandSpec = {
  args: string[];
  command: string;
  cwd?: string;
};

export type ContainerRuntime = {
  compose(
    args: string[],
    options?: ContainerRuntimeExecOptions,
  ): Promise<ContainerRuntimeResult>;
  container(
    args: string[],
    options?: ContainerRuntimeExecOptions,
  ): Promise<ContainerRuntimeResult>;
  info(options?: ContainerRuntimeExecOptions): Promise<ContainerRuntimeResult>;
  inspect<T>(
    ids: string[],
    options?: ContainerRuntimeExecOptions,
  ): Promise<T[]>;
  network(
    args: string[],
    options?: ContainerRuntimeExecOptions,
  ): Promise<ContainerRuntimeResult>;
  spawnCompose(
    args: string[],
    options?: ContainerRuntimeExecOptions,
  ): ChildProcessWithoutNullStreams;
  volume(
    args: string[],
    options?: ContainerRuntimeExecOptions,
  ): Promise<ContainerRuntimeResult>;
};

export function createContainerRuntime(
  platform: NodeJS.Platform = process.platform,
): ContainerRuntime {
  return {
    compose: (args, options) => runRuntimeCommand(platform, "compose", args, options),
    container: (args, options) =>
      runRuntimeCommand(platform, "container", args, options),
    info: (options) => runRuntimeCommand(platform, "info", [], options),
    inspect: async <T>(ids: string[], options?: ContainerRuntimeExecOptions) => {
      const inspected = await Promise.all(
        ids.map((id) => inspectRuntimeId<T>(platform, id, options)),
      );
      return inspected.flat();
    },
    network: (args, options) => runRuntimeCommand(platform, "network", args, options),
    spawnCompose: (args, options) =>
      spawnRuntimeCommand(platform, "compose", args, options),
    volume: (args, options) => runRuntimeCommand(platform, "volume", args, options),
  };
}

async function inspectRuntimeId<T>(
  platform: NodeJS.Platform,
  id: string,
  options?: ContainerRuntimeExecOptions,
) {
  try {
    const { stdout } = await runRuntimeCommand(platform, "inspect", [id], options);
    return parseInspectOutput<T>(stdout);
  } catch {
    return [];
  }
}

export function parseInspectOutput<T>(stdout: string) {
  const parsed = JSON.parse(stdout) as unknown;
  if (Array.isArray(parsed)) return parsed as T[];
  return parsed && typeof parsed === "object" ? [parsed as T] : [];
}

export function containerRuntimeEnvironment(
  env: NodeJS.ProcessEnv = process.env,
) {
  return {
    BLAME_CONTAINER_RUNTIME: runtimeName(process.platform),
    CONTAINERD_NAMESPACE: env.CONTAINERD_NAMESPACE ?? "default",
  };
}

export function runtimeCommand(
  platform: NodeJS.Platform,
  command: ContainerRuntimeCommand,
  args: string[],
) {
  const commandArgs = runtimeCommandArgs(command, args);
  if (platform === "darwin")
    return { command: "blame-lima-runtime", args: commandArgs };
  if (platform === "win32")
    return { command: "blame-wsl2-runtime", args: commandArgs };
  return { command: "nerdctl", args: commandArgs };
}

export function runtimeName(platform: NodeJS.Platform) {
  if (platform === "darwin") return "blame-lima";
  if (platform === "win32") return "blame-wsl2";
  return "blame-native";
}

function runtimeCommandArgs(command: ContainerRuntimeCommand, args: string[]) {
  if (command === "container") return args;
  if (command === "info") return ["info", ...args];
  if (command === "inspect") return ["inspect", ...args];
  return [command, ...args];
}

async function runRuntimeCommand(
  platform: NodeJS.Platform,
  command: ContainerRuntimeCommand,
  args: string[],
  options: ContainerRuntimeExecOptions = {},
) {
  const spec = runtimeCommand(platform, command, args);
  const commandSpec = commandWithRuntimeCwd(platform, spec, options.cwd);
  const result = await execFileAsync(commandSpec.command, commandSpec.args, {
    cwd: commandSpec.cwd,
    env: options.env,
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}

function spawnRuntimeCommand(
  platform: NodeJS.Platform,
  command: ContainerRuntimeCommand,
  args: string[],
  options: ContainerRuntimeExecOptions = {},
) {
  const spec = runtimeCommand(platform, command, args);
  const commandSpec = commandWithRuntimeCwd(platform, spec, options.cwd);
  return spawn(commandSpec.command, commandSpec.args, {
    cwd: commandSpec.cwd,
    env: options.env,
  });
}

function commandWithRuntimeCwd(
  platform: NodeJS.Platform,
  spec: RuntimeCommandSpec,
  cwd?: string,
): RuntimeCommandSpec {
  if (!cwd || (platform !== "darwin" && platform !== "win32"))
    return { ...spec, cwd };
  return {
    args: [
      "sh",
      "-lc",
      `cd ${shellQuote(cwd)} && exec nerdctl ${spec.args.map(shellQuote).join(" ")}`,
    ],
    command: spec.command,
  };
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
