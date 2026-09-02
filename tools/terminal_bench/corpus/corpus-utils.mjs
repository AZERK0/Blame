import { cp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const corpusRoot = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(corpusRoot, "../../..");

export async function readManifest() {
  const content = await readFile(join(corpusRoot, "manifest.json"), "utf8");
  return JSON.parse(content);
}

export function parseArguments(values) {
  const argumentsList = values[0] === "--" ? values.slice(1) : values;
  const options = new Map();
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!name?.startsWith("--") || !value)
      throw new Error(`Invalid option near ${name ?? "end"}.`);
    options.set(name.slice(2), value);
  }
  return options;
}

export async function prepareWorkspace(workspace, scenarioId) {
  await mkdir(dirname(workspace), { recursive: true });
  await cp(join(corpusRoot, "fixture"), workspace, { recursive: true });
  await writeFile(
    join(workspace, "src/project-registry.ts"),
    projectRegistry(),
    "utf8",
  );
  await writeFile(
    join(workspace, ".bench-scenario"),
    `${scenarioId}\n`,
    "utf8",
  );
  await symlink(
    join(repositoryRoot, "node_modules"),
    join(workspace, "node_modules"),
    "dir",
  );
  initializeRepository(workspace);
  return commandOutput("git", ["rev-parse", "HEAD"], workspace).trim();
}

export function runProcess(command, args, cwd, environment = process.env) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let standardErrorBytes = 0;
    child.stdout.resume();
    child.stderr.on("data", (chunk) => {
      standardErrorBytes += chunk.length;
    });
    child.on("close", (code, signal) =>
      resolveRun({ code, signal, standardErrorBytes }),
    );
  });
}

export function commandOutput(command, args, cwd, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: environment,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || `${command} failed.`);
  return result.stdout;
}

export function changedPaths(workspace) {
  const output = commandOutput(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    workspace,
  );
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
}

export function workspaceDiff(workspace) {
  const paths = changedPaths(workspace).filter(isProductPath);
  if (!paths.length) return "";
  spawnSync("git", ["add", "-N", "--", ...paths], {
    cwd: workspace,
    encoding: "utf8",
  });
  return commandOutput(
    "git",
    ["diff", "--binary", "HEAD", "--", ...paths],
    workspace,
  );
}

export function isProductPath(path) {
  return path !== "node_modules" && !path.startsWith(".blame/");
}

function initializeRepository(workspace) {
  commandOutput("git", ["init", "--initial-branch=main"], workspace);
  commandOutput(
    "git",
    ["config", "user.email", "terminal-bench@blame.local"],
    workspace,
  );
  commandOutput(
    "git",
    ["config", "user.name", "Blame Terminal Bench"],
    workspace,
  );
  commandOutput("git", ["add", "."], workspace);
  commandOutput("git", ["commit", "-m", "fixture baseline"], workspace, {
    ...process.env,
    GIT_AUTHOR_DATE: fixtureCommitDate,
    GIT_COMMITTER_DATE: fixtureCommitDate,
  });
}

const fixtureCommitDate = "2000-01-01T00:00:00Z";

function projectRegistry() {
  const entries = Array.from({ length: 180 }, (_, index) =>
    projectEntry(index + 1),
  ).join("\n");
  return `export type RegistryProject = {\n  featured: boolean;\n  id: string;\n  rank: number;\n  title: string;\n};\n\nexport const PROJECT_REGISTRY: RegistryProject[] = [\n${entries}\n];\n\nexport function selectFeaturedProjects(projects: RegistryProject[]) {\n  return projects;\n}\n`;
}

function projectEntry(position) {
  const id = String(position).padStart(3, "0");
  return `  { featured: ${position % 4 === 0}, id: "project-${id}", rank: ${181 - position}, title: "Project ${id}" },`;
}
