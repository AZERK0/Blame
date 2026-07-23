export type MarkdownWysiwygSegment =
  | { source: string; type: "text" }
  | {
      content: string
      source: string
      type: "bold" | "code" | "italic" | "strike"
    }
  | { content: string; href: string; source: string; type: "link" }

export type MarkdownWysiwygLine = {
  kind:
    | "code"
    | "fence"
    | "heading-1"
    | "heading-2"
    | "heading-3"
    | "heading-4"
    | "heading-5"
    | "heading-6"
    | "ordered-list"
    | "paragraph"
    | "quote"
    | "task"
    | "unordered-list"
  prefix: string
  segments: MarkdownWysiwygSegment[]
}

export type MarkdownInlineAction =
  | "bold"
  | "code"
  | "italic"
  | "link"
  | "strike"

const inlineMarkdownPattern =
  /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\))/g

export function markdownWysiwygLines(markdown: string): MarkdownWysiwygLine[] {
  let inCodeFence = false
  return markdown.split("\n").map((sourceLine) => {
    if (sourceLine.startsWith("```")) {
      inCodeFence = !inCodeFence
      return wysiwygLine("fence", sourceLine, "")
    }
    if (inCodeFence) return wysiwygLine("code", "", sourceLine)

    const heading = sourceLine.match(/^(#{1,6})\s(.*)$/)
    if (heading) {
      return wysiwygLine(
        `heading-${heading[1].length}` as MarkdownWysiwygLine["kind"],
        `${heading[1]} `,
        heading[2]
      )
    }
    const task = sourceLine.match(/^(\s*- \[[ xX]\] )(.*)$/)
    if (task) return wysiwygLine("task", task[1], task[2])
    const ordered = sourceLine.match(/^(\s*\d+\.\s)(.*)$/)
    if (ordered) return wysiwygLine("ordered-list", ordered[1], ordered[2])
    const unordered = sourceLine.match(/^(\s*-\s)(.*)$/)
    if (unordered)
      return wysiwygLine("unordered-list", unordered[1], unordered[2])
    const quote = sourceLine.match(/^(>\s)(.*)$/)
    if (quote) return wysiwygLine("quote", quote[1], quote[2])
    return wysiwygLine("paragraph", "", sourceLine)
  })
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
  for (const match of value.matchAll(/\[[^\]\n]+\]\([^)\n]+\)/g)) {
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
  for (const match of value.matchAll(/\[[^\]\n]+\]\([^)\n]+\)/g)) {
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
  for (const match of value.matchAll(
    /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\))/g
  )) {
    const source = match[0]
    const sourceStart = match.index
    const sourceEnd = sourceStart + source.length
    const [openingLength, closingLength] = inlineBoundaryLengths(source)
    const contentStart = sourceStart + openingLength
    const contentEnd = sourceEnd - closingLength
    if (expandedStart <= contentStart && expandedEnd >= contentEnd) {
      expandedStart = sourceStart
      expandedEnd = sourceEnd
    }
  }
  return { end: expandedEnd, start: expandedStart }
}

function inlineBoundaryLengths(source: string): [number, number] {
  if (source.startsWith("**") || source.startsWith("~~")) return [2, 2]
  if (source.startsWith("*") || source.startsWith("`")) return [1, 1]
  const closingStart = source.indexOf("](")
  return [1, source.length - closingStart - 1]
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

function wysiwygLine(
  kind: MarkdownWysiwygLine["kind"],
  prefix: string,
  content: string
): MarkdownWysiwygLine {
  return {
    kind,
    prefix,
    segments:
      kind === "code"
        ? [{ source: content, type: "text" }]
        : inlineSegments(content),
  }
}

function inlineSegments(value: string): MarkdownWysiwygSegment[] {
  const segments: MarkdownWysiwygSegment[] = []
  let offset = 0

  for (const match of value.matchAll(inlineMarkdownPattern)) {
    const index = match.index
    if (index > offset)
      segments.push({ source: value.slice(offset, index), type: "text" })
    segments.push(inlineSegment(match[0]))
    offset = index + match[0].length
  }
  if (offset < value.length || segments.length === 0) {
    segments.push({ source: value.slice(offset), type: "text" })
  }
  return segments
}

function inlineSegment(source: string): MarkdownWysiwygSegment {
  if (source.startsWith("**"))
    return { content: source.slice(2, -2), source, type: "bold" }
  if (source.startsWith("*"))
    return { content: source.slice(1, -1), source, type: "italic" }
  if (source.startsWith("~~"))
    return { content: source.slice(2, -2), source, type: "strike" }
  if (source.startsWith("`"))
    return { content: source.slice(1, -1), source, type: "code" }
  const link = source.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
  if (link) return { content: link[1], href: link[2], source, type: "link" }
  return { source, type: "text" }
}
