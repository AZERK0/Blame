import { presentBlameHarnessTool } from "./blame-harness-tool-presentation.ts"

import type { UserStoryAgentActivity } from "@/components/backlog/data/backlog-data"

export type EditedFile = {
  additions?: number
  deletions?: number
  path: string
  resolution?: string
  validation?: string
}

export type InspectedFile = {
  endLine?: number
  entireFile?: boolean
  path: string
  readKind?: string
  reused?: boolean
  parallelSuppressed?: boolean
  startLine?: number
  symbol?: string
  symbolKind?: string
  view?: string
}

export type ActivityDetail = {
  detailArtifact?: string
  durationMs?: number
  fallback: string
  input?: unknown
  output?: unknown
  raw?: unknown
  toolName?: string
}

type DisplayText = {
  text: string
  truncated: boolean
}

export function activityDetails(
  activity: UserStoryAgentActivity
): ActivityDetail {
  const parsed = parseDetail(activity.detail)
  const raw = recordValue(parsed?.raw)
  const parsedToolName = stringValue(parsed?.toolName)
  const rawToolName = stringValue(raw.toolName)
  const rawToolCall = recordValue(raw.toolCall)
  const toolName =
    parsedToolName ??
    rawToolName ??
    stringValue(rawToolCall.name) ??
    activity.toolName ??
    toolNameFromTitle(activity.title)

  const presentation = presentBlameHarnessTool({
    input: parsed?.input,
    output: parsed?.output,
    toolName,
  })

  return {
    detailArtifact: activity.detailArtifact,
    durationMs: numberValue(parsed?.durationMs),
    fallback: activity.detail,
    input: presentation.input,
    output: presentation.output,
    raw: parsed?.raw,
    toolName: presentation.toolName,
  }
}

export function detailsHasArtifact(details: ActivityDetail) {
  return Boolean(details.detailArtifact)
}

export function activityTitle(
  activity: UserStoryAgentActivity,
  details: ActivityDetail
) {
  if (activity.kind !== "tool") return activity.title
  const inspectedFiles = readFilesInput(details)
  if (inspectedFiles) {
    return `Read ${inspectedFiles.length} ${inspectedFiles.length === 1 ? "file" : "files"}`
  }
  const editedFiles = applyPatchInput(details)
  if (editedFiles) {
    return `Edited ${editedFiles.length} ${editedFiles.length === 1 ? "file" : "files"}`
  }
  if (specialistTool(details.toolName) && activity.agentName) {
    return activity.agentName
  }
  return toolLabel(details.toolName ?? activity.title)
}

export function applyPatchInput(
  details: ActivityDetail
): EditedFile[] | undefined {
  const presentedFiles = presentedEditedFiles(details)
  if (presentedFiles) return presentedFiles
  const patch =
    details.toolName === "apply_patch"
      ? applyPatchExcerpt(details.input)
      : undefined
  if (!patch) return appliedPatchOutputFiles(details.output)

  const files: EditedFile[] = []
  let current: EditedFile | undefined
  for (const line of patch.split("\n")) {
    const path = line.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/)?.[1]
    if (path) {
      current = { additions: 0, deletions: 0, path: path.trim() }
      files.push(current)
      continue
    }
    if (!current || line.startsWith("+++ ") || line.startsWith("--- ")) continue
    if (line.startsWith("+")) current.additions = (current.additions ?? 0) + 1
    if (line.startsWith("-")) current.deletions = (current.deletions ?? 0) + 1
  }
  return files.length > 0 ? files : undefined
}

function presentedEditedFiles(
  details: ActivityDetail
): EditedFile[] | undefined {
  if (details.toolName !== "apply_patch") return undefined
  const files = recordValue(details.input).files
  if (!Array.isArray(files)) return undefined
  const presented = files.flatMap((value): EditedFile[] => {
    const file = recordValue(value)
    const path = stringValue(file.path)
    return path
      ? [
          {
            path,
            additions: numberValue(file.additions),
            deletions: numberValue(file.deletions),
            resolution: stringValue(file.resolution),
            validation: stringValue(file.validation),
          },
        ]
      : []
  })
  return presented.length > 0 ? presented : undefined
}

function appliedPatchOutputFiles(value: unknown): EditedFile[] | undefined {
  const pending = [value]
  const visited = new Set<object>()

  while (pending.length > 0) {
    let candidate = pending.shift()
    if (typeof candidate === "string") {
      try {
        candidate = JSON.parse(candidate)
      } catch {
        continue
      }
    }
    if (!candidate || typeof candidate !== "object") continue
    if (visited.has(candidate)) continue
    visited.add(candidate)

    if (Array.isArray(candidate)) {
      pending.push(...candidate)
      continue
    }

    const output = candidate as Record<string, unknown>
    if (stringValue(output.query) !== "apply_patch" || output.success === false)
      continue
    const result = stringValue(output.result)
    if (!result) continue
    const fileList = result.match(
      /Successfully applied patch to the following files:\s*([\s\S]*)/i
    )?.[1]
    if (!fileList) continue
    const files = fileList
      .split("\n")
      .map((path) => path.trim())
      .filter(Boolean)
      .map((path) => ({ path }))
    if (files.length > 0) return files
  }

  return undefined
}

function applyPatchExcerpt(value: unknown): string | undefined {
  const pending = [value]
  const visited = new Set<object>()

  while (pending.length > 0) {
    const candidate = pending.shift()
    if (typeof candidate === "string") return candidate
    if (!candidate || typeof candidate !== "object") continue
    if (visited.has(candidate)) continue
    visited.add(candidate)

    if (Array.isArray(candidate)) {
      pending.unshift(...candidate)
      continue
    }

    const record = candidate as Record<string, unknown>
    const excerpt = stringValue(record.excerpt)
    if (excerpt) return excerpt
    if (record.input !== undefined) pending.unshift(record.input)
  }

  return undefined
}

export function readFilesInput(
  details: ActivityDetail
): InspectedFile[] | undefined {
  if (details.toolName !== "read_files") return undefined
  const input = recordValue(details.input)
  if (!Array.isArray(input.files)) return undefined

  const files = input.files.flatMap((value): InspectedFile[] => {
    const file = recordValue(value)
    const path = stringValue(file.path)
    if (!path) return []
    return [
      {
        endLine: positiveInteger(file.end_line),
        entireFile: file.entire_file === true,
        path,
        readKind: stringValue(file.read_kind),
        reused: file.reused === true,
        parallelSuppressed: file.parallel_suppressed === true,
        startLine: positiveInteger(file.start_line),
        symbol: stringValue(file.symbol),
        symbolKind: stringValue(file.symbol_kind),
        view: stringValue(file.view),
      },
    ]
  })
  return files.length > 0 ? files : undefined
}

function positiveInteger(value: unknown) {
  const number = numberValue(value)
  return number !== undefined && Number.isInteger(number) && number > 0
    ? number
    : undefined
}

export function inspectedLineCount(file: InspectedFile) {
  if (file.startLine === undefined || file.endLine === undefined)
    return undefined
  return Math.abs(file.endLine - file.startLine) + 1
}

export function inspectedLineRange(file: InspectedFile) {
  if (file.parallelSuppressed) return "Parallel read suppressed"
  if (file.reused) return "Content reused"
  if (file.entireFile) return "Entire file"
  if (file.symbol) {
    return [file.symbolKind, file.view].filter(Boolean).join(" · ")
  }
  if (file.readKind === "outline") return "Symbol outline"
  if (file.readKind === "bounded_preview") return "Bounded preview"
  if (file.startLine !== undefined && file.endLine !== undefined) {
    return `L${file.startLine}–${file.endLine}`
  }
  if (file.startLine !== undefined) return `From L${file.startLine}`
  if (file.endLine !== undefined) return `Through L${file.endLine}`
  return file.view ?? "Partial read"
}

export function splitFilePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const separator = normalized.lastIndexOf("/")
  if (separator < 0) return { directory: "", name: normalized }
  return {
    directory: normalized.slice(0, separator),
    name: normalized.slice(separator + 1) || normalized,
  }
}

export function outputEntries(value: unknown) {
  return arrayValue(value).map((item) => {
    const entry = recordValue(item)
    return {
      query: displayText(entry.query)?.text ?? "",
      result: displayText(entry.result) ?? displayText(scalarSummary(item)),
      success: typeof entry.success === "boolean" ? entry.success : undefined,
    }
  })
}

export function arrayValue(value: unknown) {
  if (Array.isArray(value)) return value
  return value === undefined || value === null ? [] : [value]
}

export function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : []
}

function scalarSummary(value: unknown) {
  if (typeof value === "string") return value
  if (!value || typeof value !== "object") return displayScalar(value)
  const record = value as Record<string, unknown>
  return record.output ?? record.message ?? record.reason ?? ""
}

function displayText(value: unknown): DisplayText | undefined {
  if (typeof value === "string") return { text: value, truncated: false }
  const compact = recordValue(value)
  const excerpt = stringValue(compact.excerpt)
  if (!excerpt) return undefined
  return { text: excerpt, truncated: compact.truncated === true }
}

export function displayScalar(value: unknown) {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (value === undefined) return "Not provided"
  if (value === null) return "None"
  return String(value)
}

export function codeGraphTool(toolName: string) {
  return [
    "get_code_minimal_context",
    "get_code_review_context",
    "get_code_impact_radius",
    "get_code_architecture_overview",
    "get_code_graph_status",
    "update_code_graph",
  ].includes(toolName)
}

export function specialistTool(toolName: string | undefined) {
  return toolName === "consult_specialist" || toolName === "spawn_agent"
}

function parseDetail(value: string) {
  try {
    const parsed = JSON.parse(value)
    return recordValue(parsed)
  } catch {
    return undefined
  }
}

export function toolLabel(toolName: string) {
  const normalized = toolNameFromTitle(toolName) ?? toolName
  if (normalized === "run_commands") return "Terminal command"
  if (normalized === "read_files") return "File inspection"
  if (normalized === "search_codebase") return "Code search"
  if (normalized === "fetch_web_content") return "Web content"
  if (normalized === "apply_patch") return "Code edit"
  if (normalized === "editor") return "File edit"
  if (normalized === "write_file") return "File write"
  if (normalized === "list_files") return "File listing"
  if (normalized === "get_preview_devtools") return "Preview DevTools"
  if (normalized === "get_preview_container_logs") return "Preview logs"
  if (normalized === "get_code_minimal_context") return "Code context"
  if (normalized === "get_code_review_context") return "Code review context"
  if (normalized === "get_code_impact_radius") return "Code impact"
  if (normalized === "get_code_architecture_overview")
    return "Architecture overview"
  if (normalized === "get_code_graph_status") return "Code graph status"
  if (normalized === "update_code_graph") return "Code graph update"
  if (normalized === "skills") return "Skill"
  if (normalized === "consult_specialist") return "Specialist consultation"
  if (normalized === "spawn_agent") return "Specialist consultation"
  return humanizeToolName(normalized)
}

function toolNameFromTitle(value: string) {
  return value.match(
    /(?:Tool (?:finished|started|updated|used): )?([\w-]+)$/
  )?.[1]
}

export function humanizeToolName(value: string) {
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

export function recordValue(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>
  return {}
}

export function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined
}
