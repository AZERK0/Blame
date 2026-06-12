import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { promisify } from "node:util";
import {
  runtimeCommand,
  type ContainerRuntimeCommand,
} from "./container-runtime.ts";

const execFileAsync = promisify(execFile);

type ExecFileResult = {
  stdout: string;
  stderr?: string;
};

type ExecFileRunner = (
  file: string,
  args: string[],
  options?: Record<string, unknown>,
) => Promise<ExecFileResult>;

type RuntimeContainer = {
  Id?: string;
  Config?: {
    Labels?: Record<string, string>;
  };
  State?: {
    Running?: boolean;
  };
};

type RuntimeNetwork = {
  Id?: string;
  Name?: string;
  Labels?: Record<string, string>;
  Containers?: Record<string, unknown>;
};

type CleanupInput = {
  exec?: ExecFileRunner;
};

type ComposeProject = {
  name: string;
  containers: RuntimeContainer[];
};

export function runtimeAddressPoolExhausted(error: unknown) {
  return /all predefined address pools have been fully subnetted/i.test(
    runtimeErrorText(error),
  );
}

export async function cleanupAbandonedBlamePreviews(input: CleanupInput = {}) {
  const exec = input.exec ?? defaultExecFile;
  const projects = await abandonedBlameProjects(exec);
  for (const project of projects) await cleanupProject(exec, project);
  await removeDanglingBlameNetworks(exec);
  return projects.map((project) => project.name);
}

export async function removeBlamePreviewProjectResources(
  projectName: string,
  input: CleanupInput = {},
) {
  if (!generatedBlameProjectName(projectName)) return false;
  const exec = input.exec ?? defaultExecFile;
  const containers = (await composeContainers(exec)).filter(
    (container) => composeProjectName(container) === projectName,
  );
  await removeProjectContainers(exec, containers);
  await removeProjectNetworks(exec, projectName);
  await removeProjectVolumes(exec, projectName);
  return true;
}

async function abandonedBlameProjects(exec: ExecFileRunner) {
  const projects = new Map<string, ComposeProject>();
  const containers = await composeContainers(exec);
  for (const container of containers) {
    const projectName = composeProjectName(container);
    if (!projectName) continue;
    const project = projects.get(projectName) ?? {
      name: projectName,
      containers: [],
    };
    project.containers.push(container);
    projects.set(projectName, project);
  }
  return Array.from(projects.values()).filter(
    (project) =>
      blamePreviewProject(project) &&
      project.containers.every((container) => !container.State?.Running),
  );
}

async function composeContainers(exec: ExecFileRunner) {
  const ids = await runtimeIds(exec, "container", [
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    "{{.ID}}",
  ]);
  if (ids.length === 0) return [];
  return runtimeInspect<RuntimeContainer>(exec, ids);
}

async function cleanupProject(exec: ExecFileRunner, project: ComposeProject) {
  if (await cleanupProjectWithCompose(exec, project)) return;
  await removeStoppedContainers(exec, project);
  await removeProjectNetworks(exec, project.name);
  await removeProjectVolumes(exec, project.name);
}

async function cleanupProjectWithCompose(
  exec: ExecFileRunner,
  project: ComposeProject,
) {
  const composeFile = composeConfigFiles(project).find((file) =>
    existsSync(file),
  );
  if (!composeFile) return false;
  try {
    await runtimeExec(
      exec,
      "compose",
      [
        "-f",
        composeFile,
        "--project-directory",
        composeWorkingDirectory(project, composeFile),
        "-p",
        project.name,
        "down",
        "--remove-orphans",
      ],
      {
        env: { ...process.env, COMPOSE_PROJECT_NAME: project.name },
      },
    );
    await removeProjectVolumes(exec, project.name);
    return true;
  } catch {
    return false;
  }
}

function composeConfigFiles(project: ComposeProject) {
  return uniqueStrings(
    project.containers.flatMap((container) =>
      labelValue(container, "com.docker.compose.project.config_files")
        .split(",")
        .map((file) => file.trim())
        .filter(Boolean),
    ),
  );
}

function composeWorkingDirectory(project: ComposeProject, composeFile: string) {
  return (
    project.containers
      .map((container) =>
        labelValue(container, "com.docker.compose.project.working_dir"),
      )
      .find(Boolean) || dirname(composeFile)
  );
}

async function removeStoppedContainers(
  exec: ExecFileRunner,
  project: ComposeProject,
) {
  const ids = project.containers
    .map((container) => container.Id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  try {
    await runtimeExec(exec, "container", ["rm", ...ids]);
  } catch {}
}

async function removeProjectContainers(
  exec: ExecFileRunner,
  containers: RuntimeContainer[],
) {
  const ids = containers
    .map((container) => container.Id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  try {
    await runtimeExec(exec, "container", ["rm", "--force", ...ids]);
  } catch {}
}

async function removeProjectNetworks(exec: ExecFileRunner, project: string) {
  const ids = await runtimeIds(exec, "network", [
    "ls",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--format",
    "{{.ID}}",
  ]);
  if (ids.length === 0) return;
  await removeNetworks(exec, await runtimeInspect<RuntimeNetwork>(exec, ids));
}

async function removeProjectVolumes(exec: ExecFileRunner, project: string) {
  const volumes = await runtimeIds(exec, "volume", [
    "ls",
    "--format",
    "{{.Name}}",
  ]);
  const ids = volumes.filter((volume) => volume.startsWith(`${project}_`));
  if (ids.length === 0) return;
  try {
    await runtimeExec(exec, "volume", ["rm", ...ids]);
  } catch {}
}

async function removeDanglingBlameNetworks(exec: ExecFileRunner) {
  const ids = await runtimeIds(exec, "network", [
    "ls",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    "{{.ID}}",
  ]);
  if (ids.length === 0) return;
  const networks = await runtimeInspect<RuntimeNetwork>(exec, ids);
  await removeNetworks(exec, networks.filter(danglingBlameNetwork));
}

async function removeNetworks(exec: ExecFileRunner, networks: RuntimeNetwork[]) {
  const ids = networks
    .filter((network) => Object.keys(network.Containers ?? {}).length === 0)
    .map((network) => network.Id)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return;
  try {
    await runtimeExec(exec, "network", ["rm", ...ids]);
  } catch {}
}

function danglingBlameNetwork(network: RuntimeNetwork) {
  const project = network.Labels?.["com.docker.compose.project"] ?? "";
  return blameProjectName(project) || blameProjectName(network.Name ?? "");
}

async function runtimeIds(
  exec: ExecFileRunner,
  command: ContainerRuntimeCommand,
  args: string[],
) {
  try {
    const { stdout } = await runtimeExec(exec, command, args);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function runtimeInspect<T>(exec: ExecFileRunner, ids: string[]) {
  try {
    const { stdout } = await runtimeExec(exec, "inspect", ids);
    const parsed = JSON.parse(stdout) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function blamePreviewProject(project: ComposeProject) {
  return (
    generatedBlameProjectName(project.name) ||
    project.containers.some((container) =>
      Object.hasOwn(container.Config?.Labels ?? {}, "blame.preview"),
    )
  );
}

function composeProjectName(container: RuntimeContainer) {
  return labelValue(container, "com.docker.compose.project") || undefined;
}

function blameProjectName(project: string) {
  return project.startsWith("blame_") || project.startsWith("blame-");
}

function generatedBlameProjectName(project: string) {
  return /^blame_[0-9a-f]{12}$/.test(project);
}

function labelValue(container: RuntimeContainer, key: string) {
  return container.Config?.Labels?.[key] ?? "";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function runtimeErrorText(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const record = error as Record<string, unknown>;
  return [record.message, record.stdout, record.stderr]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function runtimeExec(
  exec: ExecFileRunner,
  command: ContainerRuntimeCommand,
  args: string[],
  options?: Record<string, unknown>,
) {
  const spec = runtimeCommand(process.platform, command, args);
  return exec(spec.command, spec.args, options);
}

async function defaultExecFile(
  file: string,
  args: string[],
  options?: Record<string, unknown>,
) {
  const result = await execFileAsync(file, args, {
    ...options,
    encoding: "utf8",
  });
  return {
    stdout: String(result.stdout),
    stderr: String(result.stderr),
  };
}
