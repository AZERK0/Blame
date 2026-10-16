import type { GitConflictFile, GitStatusFile } from "@/context/platform"
import * as React from "react"

export type MergeChoice = "base" | "current" | "incoming" | "none"

export type MergeRow =
  | {
      id: string
      incoming?: string
      incomingLine?: number
      result: string
      resultLine: number
      current?: string
      currentLine?: number
      type: "context"
    }
  | {
      base?: string
      id: string
      incoming?: string
      incomingLine?: number
      row: number
      resultLine: number
      section: number
      current?: string
      currentLine?: number
      type: "conflict"
    }

export type MergeDocument = {
  finalNewline: boolean
  rows: MergeRow[]
}

export function parseMergeDocument(conflict: GitConflictFile): MergeDocument {
  return parseMergeLines(
    splitTextLines(conflict.result),
    splitTextLines(conflict.base),
    conflict
  )
}

function parseMergeLines(
  lines: string[],
  baseLines: string[],
  conflict: GitConflictFile
) {
  const state = createMergeParserState()
  while (state.index < lines.length) {
    if (lines[state.index].startsWith("<<<<<<<")) {
      parseMergeConflict(lines, baseLines, state)
    } else {
      pushContextMergeRow(lines[state.index], state)
      state.index += 1
    }
  }
  return { finalNewline: hasFinalNewline(conflict.result), rows: state.rows }
}

function parseMergeConflict(
  lines: string[],
  baseLines: string[],
  state: MergeParserState
) {
  const current = collectConflictLines(lines, state.index + 1, "=======")
  const incoming = collectConflictLines(lines, current.next + 1, ">>>>>>>")
  const base = baseLines.slice(
    state.baseLine - 1,
    state.baseLine - 1 + current.lines.length
  )
  pushConflictMergeRows(current.lines, incoming.lines, base, state)
  state.index = incoming.next + 1
}

function collectConflictLines(lines: string[], start: number, marker: string) {
  const collected: string[] = []
  let index = start
  while (index < lines.length && !lines[index].startsWith(marker)) {
    collected.push(lines[index])
    index += 1
  }
  return { lines: collected, next: index }
}

type MergeParserState = {
  baseLine: number
  currentLine: number
  index: number
  incomingLine: number
  resultLine: number
  rows: MergeRow[]
  section: number
}

function createMergeParserState(): MergeParserState {
  return {
    baseLine: 1,
    currentLine: 1,
    incomingLine: 1,
    index: 0,
    resultLine: 1,
    rows: [],
    section: 0,
  }
}

function pushContextMergeRow(line: string, state: MergeParserState) {
  state.rows.push({
    current: line,
    currentLine: state.currentLine,
    id: `context:${state.index}`,
    incoming: line,
    incomingLine: state.incomingLine,
    result: line,
    resultLine: state.resultLine,
    type: "context",
  })
  state.baseLine += 1
  state.currentLine += 1
  state.incomingLine += 1
  state.resultLine += 1
}

function pushConflictMergeRows(
  current: string[],
  incoming: string[],
  base: string[],
  state: MergeParserState
) {
  const section = state.section
  const count = Math.max(current.length, incoming.length, base.length, 1)
  for (let row = 0; row < count; row += 1) {
    state.rows.push(
      conflictMergeRow(current, incoming, base, state, section, row)
    )
  }
  state.baseLine += Math.max(base.length, count)
  state.currentLine += current.length
  state.incomingLine += incoming.length
  state.resultLine += count
  state.section += 1
}

function conflictMergeRow(
  current: string[],
  incoming: string[],
  base: string[],
  state: MergeParserState,
  section: number,
  row: number
): MergeRow {
  return {
    base: base[row],
    current: current[row],
    currentLine: lineNumberAt(state.currentLine, row, current),
    id: `conflict:${section}:${row}`,
    incoming: incoming[row],
    incomingLine: lineNumberAt(state.incomingLine, row, incoming),
    row,
    resultLine: state.resultLine + row,
    section,
    type: "conflict",
  }
}

export function initialMergeChoices(document: MergeDocument) {
  const choices: Record<string, MergeChoice> = {}
  for (const row of document.rows) {
    if (row.type === "conflict") choices[row.id] = initialMergeChoice(row)
  }
  return choices
}

function initialMergeChoice(row: Extract<MergeRow, { type: "conflict" }>) {
  if (row.base !== undefined) return "base"
  if (row.current !== undefined) return "current"
  return "incoming"
}

export function mergeDocumentContent(
  document: MergeDocument,
  choices: Record<string, MergeChoice>
) {
  const lines = document.rows.flatMap((row) => mergeRowContent(row, choices))
  return `${lines.join("\n")}${document.finalNewline ? "\n" : ""}`
}

function mergeRowContent(row: MergeRow, choices: Record<string, MergeChoice>) {
  const result = mergeRowResult(row, mergeRowChoice(row, choices))
  return result === undefined ? [] : [result]
}

export function mergeRowChoice(row: MergeRow, choices: Record<string, MergeChoice>) {
  if (row.type === "context") return "base"
  return choices[row.id] ?? initialMergeChoice(row)
}

export function mergeRowResult(row: MergeRow, choice: MergeChoice) {
  if (row.type === "context") return row.result
  if (choice === "none") return undefined
  if (choice === "current") return row.current
  if (choice === "incoming") return row.incoming
  return row.base
}

export function resultLineNumber(row: MergeRow) {
  return row.resultLine
}

export function selectMergeLine(
  setChoices: React.Dispatch<React.SetStateAction<Record<string, MergeChoice>>>
) {
  return (row: MergeRow, choice: MergeChoice) => {
    if (row.type !== "conflict") return
    setChoices((current) => ({ ...current, [row.id]: choice }))
  }
}

export function setAllChoices(
  document: MergeDocument | undefined,
  setChoices: React.Dispatch<React.SetStateAction<Record<string, MergeChoice>>>,
  choice: MergeChoice
) {
  if (!document) return
  setChoices((current) => {
    const next = { ...current }
    for (const row of document.rows) {
      if (row.type === "conflict" && mergeChoiceAvailable(row, choice))
        next[row.id] = choice
    }
    return next
  })
}

function mergeChoiceAvailable(row: MergeRow, choice: MergeChoice) {
  if (row.type === "context") return false
  return mergeRowResult(row, choice) !== undefined
}

export function activeConflictPath(conflicts: GitStatusFile[], selectedPath?: string) {
  if (selectedPath && conflicts.some((file) => file.path === selectedPath))
    return selectedPath
  return conflicts[0]?.path
}

function splitTextLines(value: string) {
  const normalized = value.replace(/\r\n/g, "\n")
  const lines = normalized.split("\n")
  if (normalized.endsWith("\n")) lines.pop()
  return lines
}

function hasFinalNewline(value: string) {
  return value.endsWith("\n")
}

function lineNumberAt(start: number, offset: number, lines: string[]) {
  return lines[offset] === undefined ? undefined : start + offset
}

export function mergeSideClassName(
  type: MergeRow["type"],
  side: "current" | "incoming",
  active: boolean
) {
  if (type === "context") return "bg-background"
  if (active) return "bg-blue-500/15"
  return side === "current" ? "bg-destructive/10" : "bg-emerald-500/10"
}

export function sideMarker(side: "current" | "incoming") {
  return side === "current" ? ">>" : "<<"
}
