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
  ".env.local.example",
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
    "Analyse ce projet vite et uniquement aux endroits strategiques fournis.",
    "Retourne un objet JSON valide sans markdown, sans texte autour.",
    "Le JSON doit respecter exactement cette forme:",
    '{"setupScript":"...","dockerCompose":"...","practices":[{"practice":"coding_style","detected":true,"comment":"..."},{"practice":"unit_tests","detected":false,"comment":"..."},{"practice":"layered_architecture","detected":true,"comment":"..."},{"practice":"commit_message_convention","detected":false,"comment":"..."}]}',
    "Le setupScript doit initialiser des git worktrees adaptes au projet, installer les dependances, preparer les fichiers env, choisir des ports hotes disponibles et lancer la preview via Docker Compose.",
    "Le dockerCompose doit garder les ports internes du projet et utiliser des ports hotes dynamiques comme ${WEB_PORT}:3000.",
    "Si un compose existe deja, inspire-toi de sa structure en ne changeant que project name unique, ports hotes dynamiques, env Blame, volumes isoles et labels metadata.",
    "Les practices sont binaires et accompagnees d'un commentaire court sur l'etat actuel.",
    "N'utilise pas d'outils d'ecriture et ne lis pas largement la codebase.",
    `Projet: ${scan.rootName}`,
    `Entrees racine: ${JSON.stringify(scan.topLevelEntries)}`,
    `Git log recent: ${JSON.stringify(scan.gitLog)}`,
    `Fichiers strategiques: ${JSON.stringify(scan.files)}`,
  ].join("\n")
}

export function parseProjectInitializationResult(text: string): ParsedProjectInitialization {
  const parsed = JSON.parse(jsonPayload(text)) as unknown
  if (!isRecord(parsed)) throw new Error("Initialization result must be an object")
  const setupScript = stringValue(parsed.setupScript)
  const dockerCompose = stringValue(parsed.dockerCompose)
  if (!setupScript) throw new Error("Initialization result is missing setupScript")
  if (!dockerCompose) throw new Error("Initialization result is missing dockerCompose")
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}
