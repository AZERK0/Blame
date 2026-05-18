import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { basename, join } from "node:path"
import { promisify } from "node:util"

import type { ProjectCodePracticeKey, ProjectCodePracticeResult } from "./types.js"

const execFileAsync = promisify(execFile)
const maxFileBytes = 16_000
const requiredPractices: ProjectCodePracticeKey[] = [
  "coding_style",
  "unit_tests",
  "layered_architecture",
  "commit_message_convention",
]
const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".turbo",
  "coverage",
])
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
]

export type ProjectInitializationScan = {
  rootName: string
  topLevelEntries: string[]
  files: Record<string, string>
  gitLog: string[]
}

type ParsedProjectInitialization = {
  setupScript: string
  dockerCompose: string
  practices: ProjectCodePracticeResult[]
}

export async function scanProjectForInitialization(root: string): Promise<ProjectInitializationScan> {
  return {
    rootName: basename(root),
    topLevelEntries: await topLevelEntries(root),
    files: await strategicFileContents(root),
    gitLog: await gitLog(root),
  }
}

export function projectInitializationPrompt(scan: ProjectInitializationScan) {
  return [
    "Analyze this project quickly and only through the strategic inputs provided.",
    "Return a valid JSON object only. No markdown, explanations, comments, or surrounding text.",
    "The JSON must match this exact shape:",
    '{"setupScript":"...","dockerCompose":"...","practices":[{"practice":"coding_style","detected":true,"comment":"..."},{"practice":"unit_tests","detected":false,"comment":"..."},{"practice":"layered_architecture","detected":true,"comment":"..."},{"practice":"commit_message_convention","detected":false,"comment":"..."}]}',

    "setupScript requirements:",
    "It must be a complete end-to-end executable bash script using set -euo pipefail.",
    "It must initialize the current already-created git worktree for preview execution.",
    "It must install dependencies, prepare required env files, select free host ports, run Docker Compose, and print final preview URLs.",
    "It must not leave startup steps to the reader and must not use placeholders, TODOs, or non-executable comments.",
    "If .env example files exist, copy or generate the required .env files from them.",
    "If the Compose file does not start dev/preview servers by itself, start them inside the containers.",

    "Worktree model:",
    "The setupScript is run from inside an already-created git worktree and must initialize only the current directory.",
    "It must not manage worktrees: no git worktree add/remove/prune/list, no tmp/worktrees, no cd to another worktree.",
    "It must never create, modify, or assume .git is a directory; .git may be a file in worktrees.",
    "Do not create anything under .git, including .git/worktrees.",

    "Environment requirements:",
    "Generated env values must be exported consistently: either source the generated .env safely or export the same values written to it.",
    "COMPOSE_PROJECT_NAME must be unique per worktree.",
    "If multiple services require env files, create each one in the correct directory.",

    "Docker Compose requirements:",
    "dockerCompose must be a directly runnable Docker Compose config.",
    "Preserve internal app ports and expose only dynamic host ports, for example ${WEB_PORT}:3000.",
    "Include all services required for a working preview.",
    "Reuse an existing Compose structure when present, changing only what is needed for isolation, dynamic ports, env, volumes, and Blame metadata.",
    "The setupScript must write dockerCompose to a compose file in the current worktree when needed, then run docker compose from there.",
    "Containers, networks, and volumes must be isolated through COMPOSE_PROJECT_NAME.",

    "Port requirements:",
    "Choose free host ports dynamically, avoid duplicates in one run, and map them to fixed internal container ports.",
    "Do not change app internal ports just to avoid host conflicts.",

    "Quality checks:",
    "Fail early with clear errors for missing required tools.",
    "Before returning, ensure setupScript does not contain forbidden patterns: git worktree, mkdir -p .git, .git/worktrees, tmp/worktrees, cd to another worktree, writing under .git.",

    "practices requirements:",
    "The practices array must contain binary detections only.",
    "Each practice must include a short comment describing the observed state.",

    "Do not use write tools.",
    "Do not read the codebase broadly.",
    "Base your answer only on the provided strategic project scan.",

    `Project: ${scan.rootName}`,
    `Root entries: ${JSON.stringify(scan.topLevelEntries)}`,
    `Recent git log: ${JSON.stringify(scan.gitLog)}`,
    `Strategic files: ${JSON.stringify(scan.files)}`,
  ].join("\n")
}

export function parseProjectInitializationResult(text: string): ParsedProjectInitialization {
  const parsed = JSON.parse(jsonPayload(text)) as unknown
  if (!isRecord(parsed)) throw new Error("Initialization result must be an object")
  const setupScript = stringValue(parsed.setupScript)
  const dockerCompose = stringValue(parsed.dockerCompose)
  if (!setupScript) throw new Error("Initialization result is missing setupScript")
  if (!dockerCompose) throw new Error("Initialization result is missing dockerCompose")
  validateGeneratedArtifacts(setupScript, dockerCompose)
  return {
    setupScript,
    dockerCompose,
    practices: parsePractices(parsed.practices),
  }
}

async function topLevelEntries(root: string) {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => !ignoredDirectories.has(entry.name))
      .slice(0, 80)
      .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
  } catch {
    return []
  }
}

async function strategicFileContents(root: string) {
  const files: Record<string, string> = {}
  for (const path of strategicFiles) {
    const content = await readStrategicFile(root, path)
    if (content) files[path] = content
  }
  return files
}

async function readStrategicFile(root: string, path: string) {
  const target = join(root, path)
  try {
    const info = await stat(target)
    if (!info.isFile() || info.size > maxFileBytes) return
    return readFile(target, "utf8")
  } catch {
    return undefined
  }
}

async function gitLog(root: string) {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-12", "--pretty=%s"], {
      cwd: root,
      timeout: 3000,
    })
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

function jsonPayload(text: string) {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) return trimmed
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match?.[1]) return match[1].trim()
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1)
  return trimmed
}

function parsePractices(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Initialization result is missing practices")
  return requiredPractices.map((practice) => parsePractice(value, practice))
}

function parsePractice(values: unknown[], practice: ProjectCodePracticeKey) {
  const value = values.find((item) => isRecord(item) && item.practice === practice)
  if (!isRecord(value)) throw new Error(`Initialization result is missing ${practice}`)
  if (typeof value.detected !== "boolean") throw new Error(`${practice} detected must be boolean`)
  const comment = stringValue(value.comment)
  if (!comment) throw new Error(`${practice} comment is required`)
  return { practice, detected: value.detected, comment }
}

function validateGeneratedArtifacts(script: string, compose: string) {
  const normalizedScript = script.toLowerCase()
  const normalizedCompose = compose.toLowerCase()
  if (!handlesEnvFiles(normalizedScript)) {
    throw new Error("Initialization result setupScript must prepare env files")
  }
  if (!launchesDockerCompose(normalizedScript)) {
    throw new Error("Initialization result setupScript must launch docker compose")
  }
  validateDockerCompose(normalizedCompose)
}

function validateDockerCompose(compose: string) {
  if (!compose.includes("services:")) {
    throw new Error("Initialization result dockerCompose must define services")
  }
  if (!hasPortMapping(compose)) {
    throw new Error("Initialization result dockerCompose must expose dynamic host ports")
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
  ])
}

function launchesDockerCompose(script: string) {
  return composeCommandPresent(script) && composeLifecyclePresent(script)
}

function hasPortMapping(compose: string) {
  return includesOneOf(compose, [
    "${web_port}:",
    "${api_port}:",
    "${frontend_port}:",
    "${port}:",
    'ports:',
  ])
}

function composeCommandPresent(value: string) {
  return /docker\s+compose|docker-compose|compose_cmd|docker_compose|compose command|compose binary/.test(value)
}

function composeLifecyclePresent(value: string) {
  return /\bup\b|\brun\b|\bstart\b/.test(value)
}

function includesOneOf(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}
