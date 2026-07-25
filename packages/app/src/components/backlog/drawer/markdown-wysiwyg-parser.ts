import {
  markdownFenceLine,
  markdownInlineSegments,
  markdownLine,
  markdownLinkMatches,
  markdownLines,
  type MarkdownInlineSegment,
  type MarkdownLine,
} from "./markdown-parser.ts"

export type MarkdownWysiwygSegment = MarkdownInlineSegment

export type MarkdownWysiwygLine = MarkdownLine

export type MarkdownInlineAction =
  | "bold"
  | "code"
  | "italic"
  | "link"
  | "strike"

export function markdownWysiwygLines(markdown: string): MarkdownWysiwygLine[] {
  return markdownLines(markdown)
}

export function markdownWysiwygStructureKey(markdown: string) {
  return markdownWysiwygLines(markdown)
    .map(markdownWysiwygLineStructureKey)
    .join("|")
}

export function markdownWysiwygStructureChanged(current: string, next: string) {
  if (current === next) return false
  const currentLines = current.split("\n")
  const nextLines = next.split("\n")
  if (currentLines.length !== nextLines.length) return true
  const currentFenceStates = markdownFenceStates(currentLines)
  const nextFenceStates = markdownFenceStates(nextLines)
  return currentLines.some(
    (line, index) =>
      line !== nextLines[index] &&
      markdownChangedLineStructureChanged(
        line,
        nextLines[index],
        currentFenceStates[index],
        nextFenceStates[index]
      )
  )
}

export function markdownListEnterResult(value: string, cursor: number) {
  const bounds = lineBounds(value, cursor)
  const line = value.slice(bounds.start, bounds.end)
  const task = line.match(/^(\s*)- \[[ xX]\]\s(.*)$/)
  const ordered = line.match(/^(\s*)(\d+)\.\s(.*)$/)
  const unordered = line.match(/^(\s*)-\s(.*)$/)
  const prefix = listContinuationPrefix(task, ordered, unordered)
  if (!prefix) return
  const content = (task?.[2] ?? ordered?.[3] ?? unordered?.[2] ?? "").trim()
  if (!content) {
    return {
      cursor: bounds.start,
      value: `${value.slice(0, bounds.start)}${value.slice(bounds.end)}`,
    }
  }
  return {
    cursor: cursor + prefix.length + 1,
    value: `${value.slice(0, cursor)}\n${prefix}${value.slice(cursor)}`,
  }
}

export function markdownListIndentResult(
  value: string,
  cursor: number,
  outdent: boolean
) {
  const bounds = lineBounds(value, cursor)
  const line = value.slice(bounds.start, bounds.end)
  if (!/^\s*(?:- \[[ xX]\]\s|-\s|\d+\.\s)/.test(line)) return
  const indentation = line.match(/^\s*/)?.[0] ?? ""
  const nextIndentation = outdent
    ? indentation.slice(0, Math.max(0, indentation.length - 2))
    : `${indentation}  `
  const nextLine = `${nextIndentation}${line.slice(indentation.length)}`
  return {
    cursor: Math.max(
      bounds.start,
      cursor + nextIndentation.length - indentation.length
    ),
    value: `${value.slice(0, bounds.start)}${nextLine}${value.slice(bounds.end)}`,
  }
}

export function markdownInlineActionResult(
  value: string,
  start: number,
  end: number,
  action: MarkdownInlineAction
) {
  const selected = value.slice(start, end)
  const [before, after] = inlineActionMarkers(action)
  return {
    cursor: start + before.length + selected.length,
    value: `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`,
  }
}

export function markdownAtomicLinkDeletionResult(
  value: string,
  start: number,
  end: number,
  key: "Backspace" | "Delete"
) {
  for (const match of markdownLinkMatches(value)) {
    const linkStart = match.index
    const linkEnd = linkStart + match[0].length
    const touchesLink =
      start === end &&
      (key === "Backspace" ? start === linkEnd : start === linkStart)
    if (!touchesLink) continue
    return {
      cursor: linkStart,
      value: `${value.slice(0, linkStart)}${value.slice(linkEnd)}`,
    }
  }
}

export function markdownEmptyListDeletionResult(value: string, cursor: number) {
  const bounds = lineBounds(value, cursor)
  const line = value.slice(bounds.start, bounds.end)
  if (
    cursor !== bounds.end ||
    !/^(?:#{1,6}\s|>\s|\s*-\s|\s*\d+\.\s|\s*- \[[ xX]\]\s)$/.test(line)
  )
    return
  return {
    cursor: bounds.start,
    value: `${value.slice(0, bounds.start)}${value.slice(bounds.end)}`,
  }
}

export function markdownArrowNavigationResult(
  value: string,
  cursor: number,
  key: "ArrowLeft" | "ArrowRight"
) {
  for (const match of markdownLinkMatches(value)) {
    const start = match.index
    const end = start + match[0].length
    if (key === "ArrowRight" && cursor === start) return end
    if (key === "ArrowLeft" && cursor === end) return start
  }
  return key === "ArrowRight"
    ? Math.min(value.length, cursor + 1)
    : Math.max(0, cursor - 1)
}

export function markdownExpandedDeletionSelection(
  value: string,
  start: number,
  end: number
) {
  let expandedStart = start
  let expandedEnd = end
  for (const entry of markdownInlineSegmentsWithStarts(value)) {
    if (entry.segment.type === "text") continue
    const sourceStart = entry.start
    const sourceEnd = sourceStart + entry.segment.source.length
    const [openingLength, closingLength] = inlineBoundaryLengths(entry.segment)
    const contentStart = sourceStart + openingLength
    const contentEnd = sourceEnd - closingLength
    if (expandedStart <= contentStart && expandedEnd >= contentEnd) {
      expandedStart = sourceStart
      expandedEnd = sourceEnd
    }
  }
  return { end: expandedEnd, start: expandedStart }
}

function inlineBoundaryLengths(
  segment: Exclude<MarkdownInlineSegment, { type: "text" }>
): [number, number] {
  if (segment.type === "bold" || segment.type === "strike") return [2, 2]
  if (segment.type === "italic" || segment.type === "code") return [1, 1]
  const closingStart = segment.source.indexOf("](")
  return [1, segment.source.length - closingStart - 1]
}

function inlineActionMarkers(action: MarkdownInlineAction): [string, string] {
  if (action === "bold") return ["**", "**"]
  if (action === "italic") return ["*", "*"]
  if (action === "strike") return ["~~", "~~"]
  if (action === "code") return ["`", "`"]
  return ["[", "]()"]
}

function lineBounds(value: string, cursor: number) {
  const start = value.lastIndexOf("\n", Math.max(0, cursor - 1)) + 1
  const nextLine = value.indexOf("\n", cursor)
  return { start, end: nextLine === -1 ? value.length : nextLine }
}

function listContinuationPrefix(
  task: RegExpMatchArray | null,
  ordered: RegExpMatchArray | null,
  unordered: RegExpMatchArray | null
) {
  if (task) return `${task[1]}- [ ] `
  if (ordered) return `${ordered[1]}${Number(ordered[2]) + 1}. `
  if (unordered) return `${unordered[1]}- `
}

function markdownChangedLineStructureChanged(
  current: string,
  next: string,
  currentInsideFence: boolean,
  nextInsideFence: boolean
) {
  if (markdownFenceLine(current) || markdownFenceLine(next)) {
    return (
      markdownWysiwygStructureKey(current) !== markdownWysiwygStructureKey(next)
    )
  }
  return (
    markdownSourceLineInputStructureKey(current, currentInsideFence) !==
    markdownSourceLineInputStructureKey(next, nextInsideFence)
  )
}

function markdownSourceLineInputStructureKey(
  source: string,
  insideFence: boolean
) {
  if (insideFence) return "code"
  const line = markdownLine(source)
  return [
    line.kind,
    line.prefix ? "prefix" : "plain",
    line.segments.map((segment) => segment.type).join(","),
  ].join(":")
}

function markdownFenceStates(lines: string[]) {
  let insideFence = false
  return lines.map((line) => {
    const state = insideFence
    if (markdownFenceLine(line)) insideFence = !insideFence
    return state
  })
}

function markdownWysiwygLineStructureKey(line: MarkdownWysiwygLine) {
  return [
    line.kind,
    line.prefix ? "prefix" : "plain",
    line.segments.every((segment) => !segment.source) ? "empty" : "content",
    line.segments.map((segment) => segment.type).join(","),
  ].join(":")
}

function markdownInlineSegmentsWithStarts(value: string) {
  let offset = 0
  return markdownInlineSegments(value).map((segment) => {
    const entry = { segment, start: offset }
    offset += segment.source.length
    return entry
  })
}
