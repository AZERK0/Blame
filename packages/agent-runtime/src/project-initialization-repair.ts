import { validateProjectInitializationArtifacts, type ProjectInitializationScan } from "./project-initialization.js"
import type {
  ProjectInitializationRepairClassification,
  RepairProjectInitializationInput,
  RepairProjectInitializationResult,
} from "./types.js"

const classifications = new Set<ProjectInitializationRepairClassification>([
  "repairable_initialization",
  "project_code_failure",
  "external_failure",
  "unknown",
])

export function projectInitializationRepairPrompt(
  input: RepairProjectInitializationInput,
  scan: ProjectInitializationScan,
) {
  return repairPrompt(input, scan)
}

export function parseProjectInitializationRepairResult(
  text: string,
  scan?: ProjectInitializationScan,
): Omit<RepairProjectInitializationResult, "sessionId"> {
  const parsed = JSON.parse(jsonPayload(text)) as unknown
  if (!isRecord(parsed)) throw new Error("Initialization repair result must be an object")
  const classification = classificationValue(parsed.classification)
  const reason = stringValue(parsed.reason)
  if (!reason) throw new Error("Initialization repair result is missing reason")
  if (classification !== "repairable_initialization") return { classification, reason }
  const setupScript = stringValue(parsed.setupScript)
  const dockerCompose = stringValue(parsed.dockerCompose)
  if (!setupScript || !dockerCompose) {
    throw new Error("Repairable initialization result must include complete artifacts")
  }
  validateProjectInitializationArtifacts(setupScript, dockerCompose, scan)
  return { classification, reason, setupScript, dockerCompose }
}

function repairPrompt(input: RepairProjectInitializationInput, scan: ProjectInitializationScan) {
  return [
    "Diagnose these project initialization diagnostics according to your system instructions and return strict JSON only.",
    `Current setupScript: ${JSON.stringify(input.setupScript)}`,
    `Current dockerCompose: ${JSON.stringify(input.dockerCompose)}`,
    `Initialization diagnostics: ${JSON.stringify(input.diagnostics)}`,
    `Project root entries: ${JSON.stringify(scan.topLevelEntries)}`,
    `Strategic project files: ${JSON.stringify(scan.files)}`,
  ].join("\n")
}

function classificationValue(value: unknown) {
  if (typeof value !== "string" || !classifications.has(value as ProjectInitializationRepairClassification)) {
    throw new Error("Initialization repair result has an invalid classification")
  }
  return value as ProjectInitializationRepairClassification
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}
