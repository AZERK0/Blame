import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import type {
  ProjectCodePracticeKey,
  ProjectCodePracticeResult,
  ProjectRunConfiguration,
} from "./types.js";

const execFileAsync = promisify(execFile);
const maxFileBytes = 16_000;
const maxCorrectionPayloadLength = 24_000;
const requiredPractices: ProjectCodePracticeKey[] = [
  "coding_style",
  "unit_tests",
  "layered_architecture",
  "commit_message_convention",
];
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
]);
const strategicFiles = [
  "package.json",
  "pnpm-workspace.yaml",
  "turbo.json",
  "vite.config.ts",
  "vite.config.js",
  "next.config.js",
  "next.config.ts",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  ".env.example",
  ".env.sample",
  ".env.template",
  ".env.local.example",
  ".env.development",
  "apps/api/.env.example",
  "apps/api/.env.sample",
  "apps/api/.env.template",
  "apps/api/package.json",
  "apps/api/src/env.ts",
  "apps/api/start/env.ts",
  "apps/backend/.env.example",
  "apps/backend/.env.sample",
  "apps/backend/.env.template",
  "apps/backend/package.json",
  "apps/backend/src/env.ts",
  "apps/backend/start/env.ts",
  "apps/frontend/.env.example",
  "apps/frontend/.env.sample",
  "apps/frontend/.env.template",
  "apps/frontend/nuxt.config.js",
  "apps/frontend/nuxt.config.ts",
  "apps/frontend/package.json",
  "apps/web/.env.example",
  "apps/web/.env.sample",
  "apps/web/.env.template",
  "apps/web/next.config.js",
  "apps/web/next.config.ts",
  "apps/web/nuxt.config.js",
  "apps/web/nuxt.config.ts",
  "apps/web/package.json",
  "README.md",
  "AGENTS.md",
  "tsconfig.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "prettier.config.js",
  ".prettierrc",
  ".vscode/tasks.json",
];
const strategicDirectories = [
  "database/migrations",
  "apps/api/database/migrations",
  "apps/backend/database/migrations",
  "apps/server/database/migrations",
  "prisma",
  "apps/api/prisma",
  "apps/backend/prisma",
  "apps/server/prisma",
  "drizzle",
  "apps/api/drizzle",
  "apps/backend/drizzle",
  "apps/server/drizzle",
];

export type ProjectInitializationScan = {
  rootName: string;
  topLevelEntries: string[];
  files: Record<string, string>;
  gitLog: string[];
};

type ParsedProjectInitialization = {
  setupScript: string;
  dockerCompose: string;
  runConfigurations: ProjectRunConfiguration[];
  practices: ProjectCodePracticeResult[];
};

type ProjectInitializationCorrection = {
  validationError: string;
  previousResult: string;
};

export async function scanProjectForInitialization(
  root: string,
): Promise<ProjectInitializationScan> {
  return {
    rootName: basename(root),
    topLevelEntries: await topLevelEntries(root),
    files: await strategicFileContents(root),
    gitLog: await gitLog(root),
  };
}

export function projectInitializationPrompt(scan: ProjectInitializationScan) {
  return [
    "Analyze this project scan according to your system instructions and return strict JSON only.",
    `Project: ${scan.rootName}`,
    `Root entries: ${JSON.stringify(scan.topLevelEntries)}`,
    `Recent git log: ${JSON.stringify(scan.gitLog)}`,
    `Strategic files: ${JSON.stringify(scan.files)}`,
  ].join("\n");
}

export function projectInitializationCorrectionPrompt(
  scan: ProjectInitializationScan,
  correction: ProjectInitializationCorrection,
) {
  return [
    projectInitializationPrompt(scan),
    "Your previous response was rejected by validation.",
    "Fix only the generated JSON output according to the validation error.",
    "Do not broaden the analysis and do not read more files.",
    "Return a complete corrected JSON object only.",
    `Validation error: ${correction.validationError}`,
    `Previous rejected response: ${truncateCorrectionPayload(correction.previousResult)}`,
  ].join("\n");
}

export function parseProjectInitializationResult(
  text: string,
  scan?: ProjectInitializationScan,
): ParsedProjectInitialization {
  const parsed = JSON.parse(jsonPayload(text)) as unknown;
  if (!isRecord(parsed))
    throw new Error("Initialization result must be an object");
  const setupScript = stringValue(parsed.setupScript);
  const dockerCompose = stringValue(parsed.dockerCompose);
  if (!setupScript)
    throw new Error("Initialization result is missing setupScript");
  if (!dockerCompose)
    throw new Error("Initialization result is missing dockerCompose");
  validateProjectInitializationArtifacts(setupScript, dockerCompose, scan);
  return {
    setupScript,
    dockerCompose,
    runConfigurations: parseRunConfigurations(parsed.runConfigurations),
    practices: parsePractices(parsed.practices),
  };
}

async function topLevelEntries(root: string) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .slice(0, 80)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
  } catch {
    return [];
  }
}

async function strategicFileContents(root: string) {
  const files: Record<string, string> = {};
  for (const path of strategicFiles) {
    const content = await readStrategicFile(root, path);
    if (content) files[path] = content;
  }
  for (const path of strategicDirectories) {
    const content = await readStrategicDirectory(root, path);
    if (content) files[`${path}/`] = content;
  }
  return files;
}

async function readStrategicFile(root: string, path: string) {
  const target = join(root, path);
  try {
    const info = await stat(target);
    if (!info.isFile() || info.size > maxFileBytes) return;
    return readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

async function readStrategicDirectory(root: string, path: string) {
  const target = join(root, path);
  try {
    const entries = await readdir(target, { withFileTypes: true });
    const names = entries
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort()
      .slice(0, 120);
    if (names.length === 0) return;
    return names.join("\n");
  } catch {
    return undefined;
  }
}

async function gitLog(root: string) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-12", "--pretty=%s"],
      {
        cwd: root,
        timeout: 3000,
      },
    );
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function jsonPayload(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (match?.[1]) return match[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parsePractices(value: unknown) {
  if (!Array.isArray(value))
    throw new Error("Initialization result is missing practices");
  return requiredPractices.map((practice) => parsePractice(value, practice));
}

export function parseRunConfigurations(value: unknown) {
  if (!Array.isArray(value))
    throw new Error("Initialization result is missing runConfigurations");
  if (value.length > 20)
    throw new Error("Initialization result has too many runConfigurations");
  const configurations = value.map(parseRunConfiguration);
  const ids = new Set(configurations.map((configuration) => configuration.id));
  if (ids.size !== configurations.length)
    throw new Error("Initialization result run configuration ids must be unique");
  if (configurations.filter((configuration) => configuration.default).length > 1)
    throw new Error("Initialization result must have at most one default run configuration");
  return configurations;
}

function parseRunConfiguration(value: unknown): ProjectRunConfiguration {
  if (!isRecord(value))
    throw new Error("Initialization run configuration must be an object");
  const id = stringValue(value.id);
  const name = stringValue(value.name);
  const command = stringValue(value.command);
  const cwd = stringValue(value.cwd);
  if (!id || !/^[a-zA-Z0-9_-]{1,80}$/.test(id))
    throw new Error("Initialization run configuration id is invalid");
  if (!name || name.length > 120)
    throw new Error("Initialization run configuration name is invalid");
  if (!command || command.length > 2_000 || /[\r\n]/.test(command))
    throw new Error("Initialization run configuration command is invalid");
  if (!cwd || cwd.length > 500 || unsafeRunConfigurationCwd(cwd))
    throw new Error("Initialization run configuration cwd must stay inside the project");
  if (typeof value.default !== "boolean")
    throw new Error("Initialization run configuration default must be boolean");
  return { id, name, command, cwd, default: value.default };
}

function unsafeRunConfigurationCwd(cwd: string) {
  return cwd.startsWith("/") || cwd.startsWith("\\") || /^[a-zA-Z]:/.test(cwd) ||
    cwd.split(/[\\/]/).includes("..");
}

function parsePractice(values: unknown[], practice: ProjectCodePracticeKey) {
  const value = values.find(
    (item) => isRecord(item) && item.practice === practice,
  );
  if (!isRecord(value))
    throw new Error(`Initialization result is missing ${practice}`);
  if (typeof value.detected !== "boolean")
    throw new Error(`${practice} detected must be boolean`);
  const comment = stringValue(value.comment);
  if (!comment) throw new Error(`${practice} comment is required`);
  return { practice, detected: value.detected, comment };
}

export function validateProjectInitializationArtifacts(
  script: string,
  compose: string,
  scan?: ProjectInitializationScan,
) {
  const normalizedScript = script.toLowerCase();
  const normalizedCompose = compose.toLowerCase();
  if (launchesCompose(normalizedScript)) {
    throw new Error(
      "Initialization result setupScript must not launch compose",
    );
  }
  if (requiresDockerRuntime(normalizedScript)) {
    throw new Error(
      "Initialization result setupScript must not require Docker or Docker Compose",
    );
  }
  validateDockerCompose(normalizedCompose, scan);
}

function validateDockerCompose(
  compose: string,
  scan?: ProjectInitializationScan,
) {
  const duplicateKey = duplicateYamlMappingKey(compose);
  if (duplicateKey) {
    throw new Error(
      `Initialization result dockerCompose must not define duplicate YAML key "${duplicateKey}" in the same mapping`,
    );
  }
  if (!compose.includes("services:")) {
    throw new Error("Initialization result dockerCompose must define services");
  }
  if (usesManualHostPort(compose)) {
    throw new Error(
      "Initialization result dockerCompose must let the runtime allocate host ports",
    );
  }
  if (!hasRuntimeAllocatedPortMapping(compose)) {
    throw new Error(
      "Initialization result dockerCompose must expose runtime-allocated host ports",
    );
  }
  if (usesProjectDockerfileBuild(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not build from project Dockerfiles",
    );
  }
  if (!runsContainersAsHostUser(compose)) {
    throw new Error(
      "Initialization result dockerCompose must run worktree services as the host user",
    );
  }
  if (!previewWorkspaceMountsProject(compose)) {
    throw new Error(
      "Initialization result dockerCompose preview service must mount the project source at /workspace",
    );
  }
  if (missingNodeDependencyInstall(compose, scan)) {
    throw new Error(
      "Initialization result dockerCompose must install detected Node dependencies before starting services",
    );
  }
  if (usesNuxtPreviewWithoutBuild(compose, scan)) {
    throw new Error(
      "Initialization result dockerCompose must build Nuxt before running its preview script or use the development script",
    );
  }
  if (compose.includes("corepack enable")) {
    throw new Error(
      "Initialization result dockerCompose must not run corepack enable",
    );
  }
  if (usesUnescapedContainerHome(compose)) {
    throw new Error(
      "Initialization result dockerCompose must escape container HOME references as $$HOME or $${HOME}",
    );
  }
  if (overridesEnvironmentDrivenServeCommand(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not append host or port flags to serve commands when HOST and PORT environment variables are already configured",
    );
  }
  if (usesInterpolatedContainerHost(compose)) {
    throw new Error(
      "Initialization result dockerCompose must bind preview services to a literal 0.0.0.0 instead of preserving an existing HOST value",
    );
  }
  if (usesInterpolatedServiceUrl(compose)) {
    throw new Error(
      "Initialization result dockerCompose must use literal service URLs for inter-container runtime configuration instead of preserving existing localhost values",
    );
  }
  if (requiresDatabaseMigration(compose, scan) && !runsDatabaseMigration(compose)) {
    throw new Error(
      "Initialization result dockerCompose must run detected database migrations before starting backend services",
    );
  }
  if (usesBarePnpm(compose)) {
    throw new Error(
      "Initialization result dockerCompose must run pnpm through corepack",
    );
  }
  if (usesNpmCi(compose)) {
    throw new Error(
      "Initialization result dockerCompose must use npm install --no-package-lock instead of npm ci",
    );
  }
  if (usesNumericSuUser(compose)) {
    throw new Error(
      "Initialization result dockerCompose must not run commands through su with numeric BLAME_HOST_UID users",
    );
  }
  if (
    usesNodeModulesVolumes(compose) &&
    !initializesNodeModulesVolumes(compose)
  ) {
    throw new Error(
      "Initialization result dockerCompose must make node_modules volumes writable by the host user before package installs",
    );
  }
}

function launchesCompose(script: string) {
  return composeCommandPresent(script) && composeLifecyclePresent(script);
}

function requiresDockerRuntime(script: string) {
  return /\b(?:command\s+-v\s+docker|docker\s+--version|docker\s+compose\s+version|docker-compose\s+--version)\b/.test(
    script,
  );
}

function usesUnescapedContainerHome(compose: string) {
  return /(?<!\$)\$(?:home\b|\{home\})/.test(compose);
}

function usesNpmCi(compose: string) {
  return /\bnpm\s+ci\b/.test(compose);
}

function usesManualHostPort(compose: string) {
  return (
    /\$\{[a-z0-9_]*port\}:/.test(compose) ||
    /(?:127\.0\.0\.1|localhost):[0-9]+:[0-9]+/.test(compose)
  );
}

function hasRuntimeAllocatedPortMapping(compose: string) {
  return includesOneOf(compose, ["127.0.0.1::", "localhost::"]);
}

function usesProjectDockerfileBuild(compose: string) {
  return /\bbuild\s*:/.test(compose) || /\bdockerfile\s*:/.test(compose);
}

function runsContainersAsHostUser(compose: string) {
  return compose.includes("user:") && compose.includes("blame_host_uid");
}

function previewWorkspaceMountsProject(compose: string) {
  if (!compose.includes("blame.preview") || !compose.includes("working_dir: /workspace")) {
    return true;
  }
  return /(?:-\s*[^:\n]+:\s*\/workspace|target:\s*\/workspace)\s*(?:#.*)?$/m.test(
    compose,
  );
}

function missingNodeDependencyInstall(
  compose: string,
  scan: ProjectInitializationScan | undefined,
) {
  if (!scan || !compose.includes("image: node:")) return false;
  if (!Object.keys(scan.files).some((path) => path.endsWith("package.json"))) {
    return false;
  }
  return !/\b(?:npm\s+(?:ci|install)|corepack\s+pnpm\s+install|yarn\s+install|bun\s+install)\b/.test(
    compose,
  );
}

function usesNuxtPreviewWithoutBuild(
  compose: string,
  scan: ProjectInitializationScan | undefined,
) {
  if (!scan || !/\bnpm\s+run\s+preview\b/.test(compose)) return false;
  const usesNuxt = Object.entries(scan.files).some(
    ([path, content]) => path.endsWith("package.json") && /"nuxt"\s*:/.test(content.toLowerCase()),
  );
  return usesNuxt && !/\b(?:npm\s+run\s+build|nuxt\s+build)\b/.test(compose);
}

function usesBarePnpm(compose: string) {
  return /(^|[\s;&|])pnpm\s/.test(compose.replace(/corepack\s+pnpm/g, ""));
}

function usesNumericSuUser(compose: string) {
  return /\bsu\s+-s\s+\/bin\/bash\s+-c\b[\s\S]*['"]#\$\{blame_host_uid\}['"]/.test(
    compose,
  );
}

function overridesEnvironmentDrivenServeCommand(compose: string) {
  if (!/\bhost:\s*0\.0\.0\.0\b/.test(compose)) return false;
  if (!/\bport:\s*[0-9]+\b/.test(compose)) return false;
  return /\b(?:node\s+ace|ace)\s+serve\b[^\n]*(?:--host|--port)\b/.test(compose);
}

function usesInterpolatedContainerHost(compose: string) {
  return /\bhost:\s*\$\{host:-0\.0\.0\.0\}/.test(compose);
}

function usesInterpolatedServiceUrl(compose: string) {
  return /\b[a-z0-9_]*(?:api|backend)[a-z0-9_]*url:\s*\$\{[a-z0-9_]+:-http:\/\/[a-z0-9_-]+:[0-9]+[^}]*\}/.test(
    compose,
  );
}

function requiresDatabaseMigration(
  compose: string,
  scan: ProjectInitializationScan | undefined,
) {
  if (!scan || !usesRelationalDatabase(compose)) return false;
  return Object.entries(scan.files).some(([path, content]) => {
    return path.endsWith("/migrations/") && content.trim().length > 0;
  });
}

function usesRelationalDatabase(compose: string) {
  return /\b(?:mysql|mariadb|postgres|postgresql):/.test(compose);
}

function runsDatabaseMigration(compose: string) {
  return /\b(?:migration:run|migrate\s+(?:deploy|dev|up|latest|run)|db:migrate|drizzle-kit\s+migrate|knex\s+migrate:latest)\b/.test(
    compose,
  );
}

function usesNodeModulesVolumes(compose: string) {
  return /:\s*\/[^\n]*node_modules\b|target:\s*\/[^\n]*node_modules\b/.test(
    compose,
  );
}

function initializesNodeModulesVolumes(compose: string) {
  return /\bchown\b[\s\S]*node_modules\b/.test(compose);
}

function composeCommandPresent(value: string) {
  return /docker\s+compose|docker-compose|compose_cmd|docker_compose|compose command|compose binary/.test(
    value,
  );
}

function composeLifecyclePresent(value: string) {
  return /\bup\b|\brun\b|\bstart\b/.test(value);
}

function includesOneOf(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

function duplicateYamlMappingKey(compose: string) {
  const stack: Array<{ indent: number; keys: Set<string> }> = [
    { indent: -1, keys: new Set() },
  ];
  for (const line of compose.split("\n")) {
    const key = yamlMappingKey(line);
    if (!key) continue;
    while (stack.length > 1 && stack[stack.length - 1].indent >= key.indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    if (parent.keys.has(key.name)) return key.name;
    parent.keys.add(key.name);
    stack.push({ indent: key.indent, keys: new Set() });
  }
  return undefined;
}

function yamlMappingKey(line: string) {
  const match = /^(\s*)([a-z0-9_.-]+):(?:\s|$)/.exec(line);
  if (!match?.[2] || line.trimStart().startsWith("-")) return undefined;
  return { indent: match[1].length, name: match[2] };
}

function truncateCorrectionPayload(value: string) {
  if (value.length <= maxCorrectionPayloadLength) return value;
  return value.slice(0, maxCorrectionPayloadLength);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}
