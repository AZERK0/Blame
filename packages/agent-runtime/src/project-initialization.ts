import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import type {
  ProjectCodePracticeKey,
  ProjectCodePracticeResult,
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
  "README.md",
  "AGENTS.md",
  "tsconfig.json",
  "eslint.config.js",
  "eslint.config.mjs",
  "prettier.config.js",
  ".prettierrc",
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
  validateGeneratedArtifacts(setupScript, dockerCompose);
  return {
    setupScript,
    dockerCompose,
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

function validateGeneratedArtifacts(script: string, compose: string) {
  const normalizedScript = script.toLowerCase();
  const normalizedCompose = compose.toLowerCase();
  if (!handlesEnvFiles(normalizedScript)) {
    throw new Error("Initialization result setupScript must prepare env files");
  }
  if (launchesDockerCompose(normalizedScript)) {
    throw new Error(
      "Initialization result setupScript must not launch docker compose",
    );
  }
  validateDockerCompose(normalizedCompose);
}

function validateDockerCompose(compose: string) {
  if (!compose.includes("services:")) {
    throw new Error("Initialization result dockerCompose must define services");
  }
  if (usesManualHostPort(compose)) {
    throw new Error(
      "Initialization result dockerCompose must let Docker allocate host ports",
    );
  }
  if (!hasDockerAllocatedPortMapping(compose)) {
    throw new Error(
      "Initialization result dockerCompose must expose Docker-allocated host ports",
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
  if (compose.includes("corepack enable")) {
    throw new Error(
      "Initialization result dockerCompose must not run corepack enable",
    );
  }
  if (usesBarePnpm(compose)) {
    throw new Error(
      "Initialization result dockerCompose must run pnpm through corepack",
    );
  }
  if (usesNodeModulesVolumes(compose) && !initializesNodeModulesVolumes(compose)) {
    throw new Error(
      "Initialization result dockerCompose must make node_modules volumes writable by the host user before package installs",
    );
  }
}

function handlesEnvFiles(script: string) {
  return includesOneOf(script, [
    ".env.example",
    ".env.sample",
    ".env.template",
    "cp .env",
    "copy .env",
    "install -m",
    "cat > .env",
    "touch .env",
  ]);
}

function launchesDockerCompose(script: string) {
  return composeCommandPresent(script) && composeLifecyclePresent(script);
}

function usesManualHostPort(compose: string) {
  return /\$\{[a-z0-9_]*port\}:/.test(compose);
}

function hasDockerAllocatedPortMapping(compose: string) {
  return includesOneOf(compose, [
    "127.0.0.1::",
    "host_ip: 127.0.0.1",
    'host_ip: "127.0.0.1"',
    "host_ip: '127.0.0.1'",
  ]);
}

function usesProjectDockerfileBuild(compose: string) {
  return /\bbuild\s*:/.test(compose) || /\bdockerfile\s*:/.test(compose);
}

function runsContainersAsHostUser(compose: string) {
  return compose.includes("user:") && compose.includes("blame_host_uid");
}

function usesBarePnpm(compose: string) {
  return /(^|[\s;&|])pnpm\s/.test(compose.replace(/corepack\s+pnpm/g, ""));
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
