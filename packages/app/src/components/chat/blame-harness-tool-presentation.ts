export type ToolPresentation = {
  input?: unknown
  output?: unknown
  toolName?: string
}

type PresentedFile = {
  additions?: number
  deletions?: number
  path: string
}

export function presentBlameHarnessTool(
  details: ToolPresentation
): ToolPresentation {
  if (details.toolName === "workspace_state") {
    return { ...details, toolName: "list_files" }
  }
  if (
    ["get_relation_context", "search_code"].includes(details.toolName ?? "")
  ) {
    return searchPresentation(details)
  }
  if (["outline_code", "inspect_code"].includes(details.toolName ?? "")) {
    return readPresentation(details)
  }
  if (["apply_change", "review_change"].includes(details.toolName ?? "")) {
    return editPresentation(details)
  }
  if (
    ["run_task", "inspect_run", "validate_change"].includes(
      details.toolName ?? ""
    )
  ) {
    return commandPresentation(details)
  }
  return details
}

function searchPresentation(details: ToolPresentation): ToolPresentation {
  const query = searchQuery(details.input)
  return {
    ...details,
    input: { queries: query ? [query] : [] },
    output: resultCards(query, details.output),
    toolName: "search_codebase",
  }
}

function readPresentation(details: ToolPresentation): ToolPresentation {
  const path = inspectedPath(details.input, details.output)
  if (!path) return { ...details, toolName: "read_files" }
  return {
    ...details,
    input: { files: [{ path }] },
    toolName: "read_files",
  }
}

function editPresentation(details: ToolPresentation): ToolPresentation {
  const files = changedFiles(details.input, details.output)
  return {
    ...details,
    input: files.length > 0 ? { files } : details.input,
    toolName: "apply_patch",
  }
}

function commandPresentation(details: ToolPresentation): ToolPresentation {
  const command = taskLabel(details.toolName, details.input)
  return {
    ...details,
    input: { commands: command ? [command] : [] },
    output: resultCards(command, details.output),
    toolName: "run_commands",
  }
}

function searchQuery(value: unknown) {
  const input = recordValue(value)
  const query = recordValue(input.query)
  const kind = stringValue(query.kind)
  const term = stringValue(query.name) ?? stringValue(query.pattern)
  const symbolRef = stringValue(recordValue(input.target).symbol_ref)
  if (symbolRef) return "symbol relations"
  if (!term) return undefined
  return kind ? `${kind}: ${term}` : term
}

function inspectedPath(input: unknown, output: unknown) {
  const target = recordValue(recordValue(input).target)
  return (
    stringValue(target.path) ??
    stringValue(recordValue(harnessData(output)).path) ??
    stringValue(recordValue(harnessData(output)).target)
  )
}

function changedFiles(input: unknown, output: unknown) {
  const resultFiles = changedFilesFromResult(output)
  return deduplicateFiles(
    resultFiles.length > 0 ? resultFiles : changedFilesFromInput(input)
  )
}

function changedFilesFromResult(output: unknown): PresentedFile[] {
  const data = recordValue(harnessData(output))
  const proposal = recordValue(data.proposal)
  const receipt = recordValue(data.receipt)
  const candidates =
    firstArray(data.files, data.changes, proposal.changes) ??
    firstArray(data.changed_files, receipt.changed_files) ??
    []
  return candidates.flatMap(presentedResultFile)
}

function presentedResultFile(value: unknown): PresentedFile[] {
  if (typeof value === "string") return [{ path: value }]
  const file = recordValue(value)
  const path = stringValue(file.path)
  if (!path) return []
  return [{ path }]
}

function changedFilesFromInput(input: unknown): PresentedFile[] {
  const operations = recordValue(input).operations
  if (!Array.isArray(operations)) return []
  return operations.flatMap((value) => operationFiles(recordValue(value)))
}

function operationFiles(operation: Record<string, unknown>): PresentedFile[] {
  const path = stringValue(operation.path)
  if (path) return [{ path }]
  const fromPath = stringValue(operation.from_path)
  const toPath = stringValue(operation.to_path)
  return [fromPath, toPath].flatMap((candidate) =>
    candidate ? [{ path: candidate }] : []
  )
}

function deduplicateFiles(files: PresentedFile[]) {
  return [...new Map(files.map((file) => [file.path, file])).values()]
}

function taskLabel(toolName: string | undefined, value: unknown) {
  const input = recordValue(value)
  if (toolName === "validate_change") return "validate change"
  if (toolName === "inspect_run") {
    return [stringValue(input.view), stringValue(input.run_ref)]
      .filter(Boolean)
      .join(" ")
  }
  const task = recordValue(input.task)
  return (
    stringValue(task.task_id) ??
    [stringValue(task.kind), stringValue(task.target)].filter(Boolean).join(" ")
  )
}

function resultCards(query: string | undefined, output: unknown) {
  if (output === undefined) return undefined
  const result = recordValue(output)
  return [
    {
      query: query ?? "Result",
      result: formattedResult(output),
      success: result.status !== "error",
    },
  ]
}

function formattedResult(output: unknown) {
  const result = recordValue(output)
  const value = result.status === "error" ? result.error : harnessData(output)
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function harnessData(value: unknown) {
  const result = recordValue(value)
  return result.data ?? value
}

function firstArray(...values: unknown[]) {
  return values.find(Array.isArray) as unknown[] | undefined
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined
}
