type MarkdownStyledSegmentType = "bold" | "code" | "italic" | "strike"

type MarkdownStyledSegment = {
  [Type in MarkdownStyledSegmentType]: {
    content: string
    source: string
    type: Type
  }
}[MarkdownStyledSegmentType]

export type MarkdownInlineSegment =
  | { source: string; type: "text" }
  | MarkdownStyledSegment
  | { content: string; href: string; source: string; type: "link" }

export type MarkdownLineKind =
  | "code"
  | "fence"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "heading-4"
  | "heading-5"
  | "heading-6"
  | "horizontal-rule"
  | "ordered-list"
  | "paragraph"
  | "quote"
  | "task"
  | "unordered-list"

export type MarkdownLine = {
  kind: MarkdownLineKind
  prefix: string
  segments: MarkdownInlineSegment[]
}

export type MarkdownTableCell = {
  segments: MarkdownInlineSegment[]
  source: string
}

export type MarkdownBlock =
  | {
      code: string
      key: string
      type: "code"
    }
  | {
      header: MarkdownTableCell[]
      key: string
      rows: MarkdownTableCell[][]
      type: "table"
    }
  | {
      key: string
      line: MarkdownLine
      lineIndex: number
      type: "line"
    }

const linkMarkdownSource = String.raw`\[[^\]\n]+\]\([^)\n]+\)`
const inlineMarkdownSource = String.raw`\`[^\`\n]+\`|\*\*[^*\n]+\*\*|\*[^*\n]+\*|~~[^~\n]+~~|${linkMarkdownSource}`
const inlineMarkdownPattern = new RegExp(`(${inlineMarkdownSource})`, "g")
const inlineMarkdownDetectionPattern = new RegExp(inlineMarkdownSource)
const linkMarkdownPattern = new RegExp(linkMarkdownSource, "g")

export function markdownLines(markdown: string) {
  let insideFence = false
  return markdown.split("\n").map((source) => {
    const line = markdownLine(source, insideFence)
    if (line.kind === "fence") insideFence = !insideFence
    return line
  })
}

export function markdownLine(
  source: string,
  insideFence = false
): MarkdownLine {
  if (markdownFenceLine(source)) return createLine("fence", source, "")
  if (insideFence) return createLine("code", "", source)
  const heading = source.match(/^(#{1,6})\s(.*)$/)
  if (heading)
    return createLine(
      `heading-${heading[1].length}` as MarkdownLineKind,
      `${heading[1]} `,
      heading[2]
    )
  const task = source.match(/^(\s*- \[[ xX]\] )(.*)$/)
  if (task) return createLine("task", task[1], task[2])
  const ordered = source.match(/^(\s*\d+\.\s)(.*)$/)
  if (ordered) return createLine("ordered-list", ordered[1], ordered[2])
  const unordered = source.match(/^(\s*-\s)(.*)$/)
  if (unordered) return createLine("unordered-list", unordered[1], unordered[2])
  const quote = source.match(/^(>\s)(.*)$/)
  if (quote) return createLine("quote", quote[1], quote[2])
  if (/^\s*---+\s*$/.test(source))
    return createLine("horizontal-rule", "", source)
  return createLine("paragraph", "", source)
}

export function markdownInlineSegments(value: string) {
  const segments: MarkdownInlineSegment[] = []
  let offset = 0
  for (const match of value.matchAll(inlineMarkdownPattern)) {
    const index = match.index
    if (index > offset)
      segments.push({ source: value.slice(offset, index), type: "text" })
    segments.push(markdownInlineSegment(match[0]))
    offset = index + match[0].length
  }
  if (offset < value.length || segments.length === 0)
    segments.push({ source: value.slice(offset), type: "text" })
  return segments
}

export function markdownHasInlineFormatting(value: string) {
  return inlineMarkdownDetectionPattern.test(value)
}

export function markdownLinkMatches(value: string) {
  return value.matchAll(linkMarkdownPattern)
}

export function markdownBlocks(markdown: string) {
  const sourceLines = markdown.split("\n")
  const parsedLines = markdownLines(markdown)
  const blocks: MarkdownBlock[] = []
  for (let index = 0; index < sourceLines.length; index += 1) {
    const code = markdownCodeBlock(sourceLines, index)
    if (code) {
      blocks.push(code.block)
      index = code.end
      continue
    }
    const table = markdownTableBlock(sourceLines, index)
    if (table) {
      blocks.push(table.block)
      index = table.end
      continue
    }
    blocks.push({
      key: `line-${index}-${sourceLines[index]}`,
      line: parsedLines[index],
      lineIndex: index,
      type: "line",
    })
  }
  return blocks
}

export function markdownFenceLine(value: string) {
  return value.startsWith("```")
}

function createLine(
  kind: MarkdownLineKind,
  prefix: string,
  content: string
): MarkdownLine {
  return {
    kind,
    prefix,
    segments:
      kind === "code"
        ? [{ source: content, type: "text" }]
        : markdownInlineSegments(content),
  }
}

function markdownInlineSegment(source: string): MarkdownInlineSegment {
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

function markdownCodeBlock(lines: string[], start: number) {
  if (!markdownFenceLine(lines[start])) return
  const codeLines: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (markdownFenceLine(lines[index]))
      return {
        block: {
          code: codeLines.join("\n"),
          key: `code-${start}`,
          type: "code" as const,
        },
        end: index,
      }
    codeLines.push(lines[index])
  }
  return {
    block: {
      code: codeLines.join("\n"),
      key: `code-${start}`,
      type: "code" as const,
    },
    end: lines.length - 1,
  }
}

function markdownTableBlock(lines: string[], start: number) {
  const header = markdownTableCells(lines[start])
  if (!header || !markdownTableSeparator(lines[start + 1])) return
  const rows: MarkdownTableCell[][] = []
  let end = start + 1
  for (let index = start + 2; index < lines.length; index += 1) {
    const cells = markdownTableCells(lines[index])
    if (!cells) break
    rows.push(cells)
    end = index
  }
  return {
    block: {
      header,
      key: `table-${start}`,
      rows,
      type: "table" as const,
    },
    end,
  }
}

function markdownTableCells(line: string | undefined) {
  if (!line?.includes("|")) return
  const content = line.trim().replace(/^\|/, "").replace(/\|$/, "")
  const sources = content.split("|").map((cell) => cell.trim())
  if (sources.length < 2) return
  return sources.map((source) => ({
    segments: markdownInlineSegments(source),
    source,
  }))
}

function markdownTableSeparator(line: string | undefined) {
  const cells = markdownTableCells(line)
  return Boolean(cells?.every((cell) => /^:?-{3,}:?$/.test(cell.source)))
}
