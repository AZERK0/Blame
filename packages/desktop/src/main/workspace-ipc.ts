import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { appendFile, chmod, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { BrowserWindow, ipcMain } from "electron";

const execFileAsync = promisify(execFile);
const previewStartupTimeoutMs = 60_000;
const previewStartupIntervalMs = 1_000;

type WorkspacePathInput = {
  root: string;
  path?: string;
};

type WorkspaceSearchInput = WorkspacePathInput & {
  query: string;
  limit?: number;
};

type CreateWorktreeInput = {
  repositoryRoot: string;
  storyId: number;
  title: string;
};

type RunProjectSetupInput = {
  worktree: string;
  setupScript: string;
  dockerCompose: string;
};

type StopProjectSetupInput = {
  worktree: string;
};

type RemoveWorktreeInput = {
  repositoryRoot: string;
  worktree: string;
};

type ResolveProjectPreviewUrlInput = {
  worktree: string;
};

type ComposeService = {
  labels?: Record<string, string> | string[];
  ports?: Array<{
    mode?: string;
    protocol?: string;
    published?: string | number;
    target?: string | number;
  }>;
};

type ComposeConfig = {
  services?: Record<string, ComposeService>;
};

type DockerContainer = {
  Config?: {
    Labels?: Record<string, string>;
  };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
  };
};

type SetupRun = {
  id: string;
  process: ChildProcessWithoutNullStreams;
};

const setupRuns = new Map<string, SetupRun>();

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle(
    "workspace:list-directory",
    (_event, input: WorkspacePathInput) => listDirectory(input),
  );
  ipcMain.handle("workspace:read-file", (_event, input: WorkspacePathInput) =>
    readWorkspaceFile(input),
  );
  ipcMain.handle(
    "workspace:search-files",
    (_event, input: WorkspaceSearchInput) => searchFiles(input),
  );
  ipcMain.handle("workspace:git-diff", (_event, input: { root: string }) =>
    gitDiff(input.root),
  );
  ipcMain.handle(
    "workspace:git-repository-fingerprint",
    (_event, input: { root: string }) => gitRepositoryFingerprint(input.root),
  );
  ipcMain.handle("workspace:create-worktree", (_event, input: CreateWorktreeInput) =>
    createWorktree(input),
  );
  ipcMain.handle("workspace:run-project-setup", (_event, input: RunProjectSetupInput) =>
    runProjectSetup(input),
  );
  ipcMain.handle("workspace:stop-project-setup", (_event, input: StopProjectSetupInput) =>
    stopProjectSetup(input),
  );
  ipcMain.handle("workspace:remove-worktree", (_event, input: RemoveWorktreeInput) =>
    removeWorktree(input),
  );
  ipcMain.handle(
    "workspace:resolve-project-preview-url",
    (_event, input: ResolveProjectPreviewUrlInput) => resolveProjectPreviewUrl(input),
  );
  ipcMain.handle("workspace:ensure-project-preview-url", (_event, input: ResolveProjectPreviewUrlInput) =>
    ensureProjectPreviewUrl(input),
  );
}

async function listDirectory(input: WorkspacePathInput) {
  const directory = resolveWorkspacePath(input);
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => ({
      name: entry.name,
      path: toWorkspacePath(input.root, resolve(directory, entry.name)),
      type: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) =>
      `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`),
    );
}

async function readWorkspaceFile(input: WorkspacePathInput) {
  const filePath = resolveWorkspacePath(input);
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Path is not a file");
  return readFile(filePath, "utf8");
}

async function searchFiles(input: WorkspaceSearchInput) {
  const root = resolve(input.root);
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = Math.min(input.limit ?? 30, 100);
  const matches: Array<{ name: string; path: string; type: "file" }> = [];
  await walk(root, root, query, limit, matches);
  return matches;
}

async function gitDiff(root: string) {
  const cwd = resolve(root);
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--no-ext-diff", "--"],
    { cwd },
  );
  return stdout;
}

async function gitRepositoryFingerprint(root: string) {
  const cwd = resolve(root);
  const remoteUrls = await gitRemoteUrls(cwd);
  if (remoteUrls.length > 0) {
    return fingerprintValue(["remotes", ...remoteUrls]);
  }

  const rootCommits = await gitRootCommits(cwd);
  if (rootCommits.length > 0) {
    return fingerprintValue(["root-commits", ...rootCommits]);
  }

  return null;
}

async function createWorktree(input: CreateWorktreeInput) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const repositoryName = basename(repositoryRoot);
  const slug = storySlug(input.storyId, input.title);
  const branch = `blame/story-${input.storyId}-${slug}`;
  const worktree = resolve(
    dirname(repositoryRoot),
    ".blame-worktrees",
    repositoryName,
    `story-${input.storyId}-${slug}`,
  );

  await assertGitRepository(repositoryRoot);
  await mkdir(dirname(worktree), { recursive: true });

  if (await worktreeRegistered(repositoryRoot, worktree)) {
    return { worktree, branch };
  }

  if (existsSync(worktree)) {
    throw new Error("Worktree directory already exists but is not registered");
  }

  if (await branchExists(repositoryRoot, branch)) {
    await execFileAsync("git", ["worktree", "add", worktree, branch], {
      cwd: repositoryRoot,
    });
    return { worktree, branch };
  }

  await execFileAsync("git", ["worktree", "add", "-b", branch, worktree, "HEAD"], {
    cwd: repositoryRoot,
  });
  return { worktree, branch };
}

async function runProjectSetup(input: RunProjectSetupInput) {
  const worktree = resolve(input.worktree);
  await assertGitRepository(worktree);
  const directory = join(worktree, ".blame", "initialization");
  const scriptPath = join(directory, "setup.sh");
  const composePath = join(directory, "docker-compose.yml");
  const logPath = setupLogPath(worktree);

  await mkdir(directory, { recursive: true });
  await mkdir(dirname(logPath), { recursive: true });
  await writeFile(scriptPath, input.setupScript, "utf8");
  await writeFile(logPath, "", "utf8");
  await writeFile(
    composePath,
    dockerComposeForPreview(input.dockerCompose, worktree),
    "utf8",
  );
  await chmod(scriptPath, 0o755);

  const runId = randomUUID();
  const child = spawn("bash", [scriptPath], {
    cwd: worktree,
    env: setupEnvironment(worktree),
  });
  setupRuns.set(runId, { id: runId, process: child });

  child.stdout.on("data", (data: Buffer) =>
    emitSetupOutput(runId, worktree, "stdout", data.toString()),
  );
  child.stderr.on("data", (data: Buffer) =>
    emitSetupOutput(runId, worktree, "stderr", data.toString()),
  );
  child.on("exit", (code) => {
    void completeProjectSetup(runId, worktree, code);
  });

  return { runId };
}

async function completeProjectSetup(
  runId: string,
  worktree: string,
  code: number | null,
) {
  if (code !== 0) {
    setupRuns.delete(runId);
    emitSetupOutput(runId, worktree, "exit", String(code ?? ""));
    return;
  }

  try {
    const existingPreviewUrl = await labeledContainerPreviewUrl(worktree);
    if (!existingPreviewUrl) await startProjectCompose(worktree);
    setupRuns.delete(runId);
    emitSetupOutput(runId, worktree, "stdout", "Project preview containers are running.\n");
    emitSetupOutput(runId, worktree, "exit", "0");
  } catch (error) {
    setupRuns.delete(runId);
    emitSetupOutput(runId, worktree, "stderr", errorMessage(error));
    emitSetupOutput(runId, worktree, "exit", "1");
  }
}

async function startProjectCompose(worktree: string) {
  await execFileAsync(
    "docker",
    [
      "compose",
      "-f",
      projectComposePath(worktree),
      "--project-directory",
      worktree,
      "up",
      "-d",
      "--remove-orphans",
    ],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  const previewUrl = await resolveProjectPreviewUrl({ worktree });
  if (!previewUrl) throw new Error("Unable to resolve project preview URL");
  await waitForPreview(previewUrl);
  return previewUrl;
}

async function stopProjectSetup(input: StopProjectSetupInput) {
  const worktree = resolve(input.worktree);
  const composePath = join(worktree, ".blame", "initialization", "docker-compose.yml");
  if (!existsSync(composePath)) return false;
  await execFileAsync(
    "docker",
    [
      "compose",
      "-f",
      composePath,
      "--project-directory",
      worktree,
      "down",
      "--remove-orphans",
    ],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  return true;
}

async function removeWorktree(input: RemoveWorktreeInput) {
  const repositoryRoot = resolve(input.repositoryRoot);
  const worktree = resolve(input.worktree);
  await assertGitRepository(repositoryRoot);
  if (!(await worktreeRegistered(repositoryRoot, worktree))) return false;
  await execFileAsync("git", ["worktree", "remove", "--force", worktree], {
    cwd: repositoryRoot,
  });
  return true;
}

async function resolveProjectPreviewUrl(input: ResolveProjectPreviewUrlInput) {
  const worktree = resolve(input.worktree);
  await assertGitRepository(worktree);
  const composePath = projectComposePath(worktree);
  if (!existsSync(composePath)) return labeledContainerPreviewUrl(worktree);
  const previewTarget = await composePreviewTarget(worktree, composePath);
  if (!previewTarget) return labeledContainerPreviewUrl(worktree);
  const address = await composePublishedAddress(
    worktree,
    composePath,
    previewTarget.service,
    previewTarget.port,
  );
  if (!address) return labeledContainerPreviewUrl(worktree);
  return previewUrl(address, previewTarget.protocol, previewTarget.path);
}

async function ensureProjectPreviewUrl(input: ResolveProjectPreviewUrlInput) {
  const worktree = resolve(input.worktree);
  await assertGitRepository(worktree);
  const currentUrl = await resolveProjectPreviewUrl({ worktree });
  if (currentUrl && (await previewResponds(currentUrl))) return currentUrl;
  return startProjectCompose(worktree);
}

async function walk(
  root: string,
  directory: string,
  query: string,
  limit: number,
  matches: Array<{ name: string; path: string; type: "file" }>,
) {
  if (matches.length >= limit) return;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (matches.length >= limit || shouldSkip(entry.name)) continue;
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(root, entryPath, query, limit, matches);
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().includes(query)) {
      matches.push({
        name: entry.name,
        path: toWorkspacePath(root, entryPath),
        type: "file",
      });
    }
  }
}

function resolveWorkspacePath(input: WorkspacePathInput) {
  const root = resolve(input.root);
  const target = resolve(root, input.path ?? ".");
  if (target !== root && !target.startsWith(`${root}${sep}`))
    throw new Error("Path escapes workspace");
  return target;
}

function toWorkspacePath(root: string, target: string) {
  const path = relative(resolve(root), target);
  return path || ".";
}

function shouldSkip(name: string) {
  return [".git", "node_modules", "dist", "build", ".turbo"].includes(name);
}

async function gitRemoteUrls(cwd: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get-regexp", "^remote\\..*\\.url$"],
      { cwd },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/\s+/, 2)[1])
      .filter(Boolean)
      .map(normalizeGitRemoteUrl)
      .sort();
  } catch {
    return [];
  }
}

async function assertGitRepository(cwd: string) {
  await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd });
}

async function branchExists(cwd: string, branch: string) {
  try {
    await execFileAsync(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      { cwd },
    );
    return true;
  } catch {
    return false;
  }
}

async function worktreeRegistered(cwd: string, worktree: string) {
  const { stdout } = await execFileAsync(
    "git",
    ["worktree", "list", "--porcelain"],
    { cwd },
  );
  return stdout
    .split("\n")
    .some((line) => line.trim() === `worktree ${worktree}`);
}

function storySlug(storyId: number, title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || `story-${storyId}`;
}

function setupEnvironment(worktree: string) {
  return {
    ...process.env,
    BLAME_HOST_GID: hostGroupId(),
    BLAME_HOST_UID: hostUserId(),
    BLAME_DOCKER_COMPOSE_FILE: projectComposePath(worktree),
    BLAME_INITIALIZATION_DIR: join(worktree, ".blame", "initialization"),
    COMPOSE_PROJECT_NAME: `blame_${createHash("sha1")
      .update(worktree)
      .digest("hex")
      .slice(0, 12)}`,
  };
}

function hostUserId() {
  return typeof process.getuid === "function"
    ? String(process.getuid())
    : "1000";
}

function hostGroupId() {
  return typeof process.getgid === "function"
    ? String(process.getgid())
    : "1000";
}

function dockerComposeForPreview(compose: string, worktree: string) {
  return dockerComposeWithCorepackPnpm(
    dockerComposeWithHostUser(compose, worktree),
  );
}

function dockerComposeWithHostUser(compose: string, worktree: string) {
  const lines = compose.split("\n");
  const servicesLine = serviceSectionLine(lines);
  if (servicesLine === -1) return compose;
  return addHostUserToServices(lines, servicesLine, worktree).join("\n");
}

function dockerComposeWithCorepackPnpm(compose: string) {
  return compose
    .replace(/\bcorepack\s+enable\s*&&\s*/g, "")
    .replace(/(?<!\bcorepack\s)\bpnpm(?=\s)/g, "corepack pnpm");
}

function serviceSectionLine(lines: string[]) {
  return lines.findIndex((line) => /^services:\s*(?:#.*)?$/.test(line));
}

function addHostUserToServices(
  lines: string[],
  servicesLine: number,
  worktree: string,
) {
  const result: string[] = [];
  const serviceIndent = /^\s*/.exec(lines[servicesLine])?.[0].length ?? 0;
  const childIndent = serviceIndent + 2;

  for (let index = 0; index < lines.length; index += 1) {
    if (
      index > servicesLine &&
      startsNextTopLevelSection(lines[index], serviceIndent)
    ) {
      result.push(...lines.slice(index));
      break;
    }
    const serviceBlock = readServiceBlock(lines, index, childIndent);
    if (!serviceBlock || index <= servicesLine) {
      result.push(lines[index]);
      continue;
    }
    result.push(...hostUserServiceBlock(serviceBlock, worktree));
    index = serviceBlock.end;
  }

  return result;
}

function readServiceBlock(lines: string[], start: number, indent: number) {
  if (!isServiceLine(lines[start], indent)) return null;
  let end = start;
  while (
    end + 1 < lines.length &&
    !startsNextTopLevelSection(lines[end + 1], indent - 2) &&
    !isServiceLine(lines[end + 1], indent)
  ) {
    end += 1;
  }
  return { lines: lines.slice(start, end + 1), end };
}

function startsNextTopLevelSection(line: string, indent: number) {
  if (!line.trim() || line.trim().startsWith("#")) return false;
  return new RegExp(`^\\s{0,${indent}}\\S`).test(line);
}

function isServiceLine(line: string, indent: number) {
  return new RegExp(`^\\s{${indent}}[a-zA-Z0-9_.-]+:\\s*(?:#.*)?$`).test(line);
}

function hostUserServiceBlock(
  block: { lines: string[]; end: number },
  worktree: string,
) {
  if (block.lines.some((line) => /^\s{4}user:\s*/.test(line)))
    return block.lines;
  if (!mountsWorktree(block.lines, worktree)) return block.lines;
  const [serviceLine, ...serviceBody] = block.lines;
  return [
    serviceLine,
    '    user: "${BLAME_HOST_UID}:${BLAME_HOST_GID}"',
    ...serviceBody,
  ];
}

function mountsWorktree(lines: string[], worktree: string) {
  const service = lines.join("\n");
  const escapedWorktree = escapeRegExp(worktree);
  return (
    /(^|\n)\s*-\s*(?:\.|\$PWD|\$\{PWD\})(?:\/[^:]*)?:/.test(service) ||
    /source:\s*(?:\.|\$PWD|\$\{PWD\})/.test(service) ||
    new RegExp(`(^|\\n)\\s*-\\s*${escapedWorktree}(?:\\/[^:]*)?:`).test(
      service,
    ) ||
    new RegExp(`source:\\s*${escapedWorktree}`).test(service)
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function projectComposePath(worktree: string) {
  return join(worktree, ".blame", "initialization", "docker-compose.yml");
}

function setupLogPath(worktree: string) {
  return join(worktree, ".blame", "logs", "setup.log");
}

async function composePreviewTarget(worktree: string, composePath: string) {
  const config = await composeConfig(worktree, composePath);
  const services = Object.entries(config.services ?? {});
  const labeledTarget = services
    .map(([service, config]) => labeledPreviewTarget(service, config))
    .find(Boolean);
  if (labeledTarget) return labeledTarget;
  return services
    .map(([service, config]) => exposedPreviewTarget(service, config))
    .find(Boolean);
}

async function composeConfig(
  worktree: string,
  composePath: string,
): Promise<ComposeConfig> {
  const { stdout } = await execFileAsync(
    "docker",
    [
      "compose",
      "-f",
      composePath,
      "--project-directory",
      worktree,
      "config",
      "--format",
      "json",
    ],
    { cwd: worktree, env: setupEnvironment(worktree) },
  );
  const parsed = JSON.parse(stdout) as unknown;
  if (!parsed || typeof parsed !== "object") return {};
  return parsed as ComposeConfig;
}

function labeledPreviewTarget(service: string, config: ComposeService) {
  const labels = serviceLabels(config);
  if (labels["blame.preview"] !== "true") return undefined;
  const port = numberValue(labels["blame.preview.port"]);
  if (!port) return undefined;
  return {
    service,
    port,
    protocol: labels["blame.preview.protocol"] || "http",
    path: labels["blame.preview.path"] || "/",
  };
}

function exposedPreviewTarget(service: string, config: ComposeService) {
  const port = config.ports?.find((port) => numberValue(port.target));
  const target = numberValue(port?.target);
  if (!target) return undefined;
  return {
    service,
    port: target,
    protocol: "http",
    path: "/",
  };
}

function serviceLabels(config: ComposeService) {
  if (!config.labels) return {};
  if (!Array.isArray(config.labels)) return config.labels;
  return Object.fromEntries(
    config.labels
      .map((label) => label.split("=", 2))
      .filter(([key]) => Boolean(key))
      .map(([key, value]) => [key, value ?? "true"]),
  );
}

async function composePublishedAddress(
  worktree: string,
  composePath: string,
  service: string,
  port: number,
) {
  try {
    const { stdout } = await execFileAsync(
      "docker",
      [
        "compose",
        "-f",
        composePath,
        "--project-directory",
        worktree,
        "port",
        service,
        String(port),
      ],
      { cwd: worktree, env: setupEnvironment(worktree) },
    );
    return stdout.trim().split("\n").find(Boolean);
  } catch {
    return undefined;
  }
}

async function labeledContainerPreviewUrl(worktree: string) {
  const containers = await previewContainers();
  const container = containers.find((container) =>
    containerMatchesWorktree(container, worktree),
  );
  if (!container) return null;
  const labels = container.Config?.Labels ?? {};
  const port = labels["blame.preview.port"];
  if (!port) return null;
  const binding = container.NetworkSettings?.Ports?.[`${port}/tcp`]?.[0];
  if (!binding?.HostPort) return null;
  const host = binding.HostIp || "127.0.0.1";
  return previewUrl(
    `${host}:${binding.HostPort}`,
    labels["blame.preview.protocol"] || "http",
    labels["blame.preview.path"] || "/",
  );
}

async function previewContainers() {
  try {
    const { stdout } = await execFileAsync("docker", [
      "ps",
      "--filter",
      "label=blame.preview=true",
      "--format",
      "{{.ID}}",
    ]);
    const ids = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (ids.length === 0) return [];
    const { stdout: inspectOutput } = await execFileAsync("docker", [
      "inspect",
      ...ids,
    ]);
    const parsed = JSON.parse(inspectOutput) as unknown;
    return Array.isArray(parsed) ? (parsed as DockerContainer[]) : [];
  } catch {
    return [];
  }
}

function containerMatchesWorktree(container: DockerContainer, worktree: string) {
  const labels = container.Config?.Labels ?? {};
  const workingDir = labels["com.docker.compose.project.working_dir"];
  const configFiles = labels["com.docker.compose.project.config_files"];
  return (
    workingDir === worktree ||
    Boolean(
      configFiles
        ?.split(",")
        .some((file) => resolve(file).startsWith(`${worktree}${sep}`)),
    )
  );
}

async function waitForPreview(url: string) {
  const deadline = Date.now() + previewStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (await previewResponds(url)) return;
    await delay(previewStartupIntervalMs);
  }
  throw new Error(`Preview did not respond at ${url}`);
}

async function previewResponds(url: string) {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.status < 500;
  } catch {
    return false;
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function previewUrl(address: string, protocol: string, path: string) {
  const normalizedAddress = address
    .replace(/^0\.0\.0\.0:/, "127.0.0.1:")
    .replace(/^\[::\]:/, "127.0.0.1:");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}://${normalizedAddress}${normalizedPath}`;
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? `${error.message}\n` : "Project setup failed.\n";
}

function emitSetupEvent(
  runId: string,
  type: "stdout" | "stderr" | "exit",
  data: string,
) {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send(`workspace:setup:event:${runId}`, {
      runId,
      type,
      data,
    });
  });
}

function emitSetupOutput(
  runId: string,
  worktree: string,
  type: "stdout" | "stderr" | "exit",
  data: string,
) {
  void appendFile(setupLogPath(worktree), setupLogText(type, data), "utf8");
  emitSetupEvent(runId, type, data);
}

function setupLogText(type: "stdout" | "stderr" | "exit", data: string) {
  if (type !== "exit") return data;
  return `\n[setup exited with code ${data}]\n`;
}

async function gitRootCommits(cwd: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-list", "--max-parents=0", "HEAD"],
      { cwd },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .sort();
  } catch {
    return [];
  }
}

function normalizeGitRemoteUrl(value: string) {
  const trimmed = value.trim().replace(/\.git$/, "");
  const sshMatch = trimmed.match(/^([^@]+@[^:]+):(.+)$/);
  if (sshMatch) {
    return `ssh://${sshMatch[1]}/${sshMatch[2]}`.toLowerCase();
  }
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

function fingerprintValue(parts: string[]) {
  return `git:${createHash("sha256").update(parts.join("\n")).digest("hex")}`;
}
