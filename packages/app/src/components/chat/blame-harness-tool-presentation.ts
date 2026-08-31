export type ToolPresentation = {
  input?: unknown
  output?: unknown
  toolName?: string
}

type PresentedFile = {
  additions?: number
  deletions?: number
  path: string
  resolution?: string
  validation?: string
}

const hiddenSemanticReferenceFields = new Set([
  "file_ref",
  "match_ref",
  "node_ref",
  "symbol_ref",
  "new_symbol_refs",
])

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
  if (
    ["outline_code", "inspect_code", "read_code"].includes(
      details.toolName ?? ""
    )
  ) {
    return readPresentation(details)
  }
  if (
    ["apply_change", "edit_code", "review_change"].includes(
      details.toolName ?? ""
    )
  ) {
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
    input: { files: [presentedReadFile(details, path)] },
    toolName: "read_files",
  }
}

function presentedReadFile(details: ToolPresentation, path: string) {
  const input = recordValue(details.input)
  const data = recordValue(harnessData(details.output))
  const semanticTarget = recordValue(data.semantic_target)
  const isOutline =
    details.toolName === "outline_code" || stringValue(data.view) === "outline"
  const requestedRange = numberPair(input.range_utf8_bytes)
  const status = stringValue(data.status)
  const reused = ["already_available", "already_in_context"].includes(
    status ?? ""
  )
  const parallelSuppressed =
    status === "in_flight_reused" ||
    data.parallel_broad_read_suppressed === true
  const autoNarrowedKind = stringValue(data.auto_narrowed_kind)
  const inputTargetType =
    readTargetType(recordValue(input.target)) ??
    (stringValue(input.view) === "symbol" ? "symbol" : undefined)
  return {
    path,
    view: isOutline
      ? "outline"
      : (stringValue(data.view) ?? stringValue(input.view)),
    read_kind: presentedReadKind(
      semanticTarget,
      inputTargetType,
      requestedRange,
      isOutline,
      autoNarrowedKind,
      parallelSuppressed
    ),
    ...presentedSemanticTarget(semanticTarget),
    ...presentedLineRange(data.line_range),
    entire_file: isEntireFileRead({
      data,
      inputTargetType,
      isOutline,
      requestedRange,
      semanticTarget,
      reused,
      contentCoverage: stringValue(data.content_coverage),
    }),
    reused,
    ...(parallelSuppressed ? { parallel_suppressed: true } : {}),
  }
}

function presentedLineRange(value: unknown) {
  const range = numberPair(value)
  return range ? { start_line: range[0], end_line: range[1] } : {}
}

function readTargetType(target: Record<string, unknown>) {
  if (target.symbol_ref) return "symbol"
  if (target.node_ref) return "node"
  return undefined
}

function presentedReadKind(
  target: Record<string, unknown>,
  inputTargetType: string | undefined,
  requestedRange: [number, number] | undefined,
  isOutline: boolean,
  autoNarrowedKind?: string,
  parallelSuppressed = false
) {
  if (parallelSuppressed) return "parallel_suppressed"
  if (autoNarrowedKind === "semantic_outline") return "outline"
  if (autoNarrowedKind === "bounded_preview") return "bounded_preview"
  return (
    stringValue(target.type) ??
    inputTargetType ??
    (requestedRange ? "range" : isOutline ? "outline" : "file")
  )
}

function presentedSemanticTarget(target: Record<string, unknown>) {
  const symbol = stringValue(target.qualified_name)
  const symbolKind = stringValue(target.kind)
  return {
    ...(symbol ? { symbol } : {}),
    ...(symbolKind ? { symbol_kind: symbolKind } : {}),
  }
}

function isEntireFileRead(input: {
  data: Record<string, unknown>
  inputTargetType?: string
  isOutline: boolean
  requestedRange?: [number, number]
  reused: boolean
  semanticTarget: Record<string, unknown>
  contentCoverage?: string
}) {
  return (
    !input.isOutline &&
    !input.requestedRange &&
    !input.inputTargetType &&
    !input.semanticTarget.type &&
    !["none", "partial"].includes(input.contentCoverage ?? "") &&
    (numberValue(input.data.omitted_bytes) ?? 0) === 0 &&
    !input.reused
  )
}

function editPresentation(details: ToolPresentation): ToolPresentation {
  const files = changedFiles(details.input, details.output)
  const envelope = recordValue(harnessResultEnvelope(details.output))
  const outcome = stringValue(envelope.outcome)
  const status = stringValue(envelope.status)
  const blocked = ["blocked", "failed"].includes(status ?? "")
  return {
    ...details,
    input:
      files.length > 0 || blocked || (outcome && outcome !== "applied")
        ? { files }
        : details.input,
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
  if (typeof input.query === "string") return input.query
  const query = recordValue(input.query)
  const kind = stringValue(query.kind)
  const term = stringValue(query.name) ?? stringValue(query.pattern)
  const symbolRef = stringValue(recordValue(input.target).symbol_ref)
  if (symbolRef) return "symbol relations"
  if (!term) return undefined
  return kind ? `${kind}: ${term}` : term
}

function inspectedPath(input: unknown, output: unknown) {
  const inputTarget = recordValue(input).target
  const target = recordValue(inputTarget)
  return (
    (typeof inputTarget === "string" && !/^s\d+$/u.test(inputTarget)
      ? inputTarget.split("#", 1)[0]
      : undefined) ??
    stringValue(target.path) ??
    stringValue(recordValue(harnessData(output)).path) ??
    stringValue(recordValue(harnessData(output)).target)
  )
}

function changedFiles(input: unknown, output: unknown) {
  const envelope = harnessResultEnvelope(output)
  const resultFiles = changedFilesFromResult(envelope)
  const outcome = stringValue(recordValue(envelope).outcome)
  const status = stringValue(recordValue(envelope).status)
  if (["blocked", "failed"].includes(status ?? "")) return resultFiles
  if (outcome && outcome !== "applied") return resultFiles
  return deduplicateFiles(
    resultFiles.length > 0 ? resultFiles : changedFilesFromInput(input)
  )
}

function harnessResultEnvelope(output: unknown) {
  const current = recordValue(output)
  const nested = recordValue(current.output)
  return stringValue(nested.outcome) ? nested : output
}

function changedFilesFromResult(output: unknown): PresentedFile[] {
  const data = recordValue(harnessData(output))
  const proposal = recordValue(data.proposal)
  const receipt = recordValue(data.receipt)
  const candidates =
    firstArray(data.files, data.changes, proposal.changes) ??
    firstArray(data.changed_files, receipt.changed_files) ??
    []
  const resolution = stringValue(data.resolution)
  const validation =
    stringValue(recordValue(data.parse).status) ??
    stringValue(recordValue(data.validation).parse)
  return candidates.flatMap((value) =>
    presentedResultFile(value, {
      ...(resolution ? { resolution } : {}),
      ...(validation ? { validation } : {}),
    })
  )
}

function presentedResultFile(
  value: unknown,
  metadata: Pick<PresentedFile, "resolution" | "validation"> = {}
): PresentedFile[] {
  if (typeof value === "string") return [{ path: value, ...metadata }]
  const file = recordValue(value)
  const path = stringValue(file.path)
  if (!path) return []
  return [
    {
      path,
      ...(numberValue(file.additions) !== undefined
        ? { additions: numberValue(file.additions) }
        : {}),
      ...(numberValue(file.deletions) !== undefined
        ? { deletions: numberValue(file.deletions) }
        : {}),
      ...metadata,
    },
  ]
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
  const packages = Array.isArray(input.packages)
    ? input.packages.filter(
        (value): value is string => typeof value === "string"
      )
    : []
  return (
    stringValue(input.command) ??
    (typeof input.task === "string" ? input.task : undefined) ??
    (typeof input.action === "string" && packages.length
      ? `${input.action} ${packages.join(" ")}`
      : undefined) ??
    stringValue(task.task_id) ??
    [stringValue(task.kind), stringValue(task.target)].filter(Boolean).join(" ")
  )
}

function resultCards(query: string | undefined, output: unknown) {
  if (output === undefined) return undefined
  return [
    {
      query: query ?? "Result",
      result: formattedResult(output),
      success: successfulResult(output),
    },
  ]
}

function successfulResult(output: unknown) {
  const result = recordValue(output)
  if (["blocked", "error", "failed"].includes(String(result.status)))
    return false
  const data = recordValue(harnessData(output))
  const status = stringValue(data.status)
  const outcome = stringValue(data.outcome)
  if (
    ["cancelled", "execution_error", "failed", "timed_out"].includes(
      status ?? ""
    )
  )
    return false
  return !["infrastructure_error", "task_failure"].includes(outcome ?? "")
}

function formattedResult(output: unknown) {
  const result = recordValue(output)
  const value = result.status === "error" ? result.error : harnessData(output)
  if (typeof value === "string") return value
  try {
    return JSON.stringify(humanReadableResult(value), null, 2)
  } catch {
    return String(value)
  }
}

function humanReadableResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(humanReadableResult)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !hiddenSemanticReferenceFields.has(key))
      .map(([key, entry]) => [key, humanReadableResult(entry)])
  )
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

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function numberPair(value: unknown): [number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined
  const first = numberValue(value[0])
  const second = numberValue(value[1])
  return first !== undefined && second !== undefined
    ? [first, second]
    : undefined
}
