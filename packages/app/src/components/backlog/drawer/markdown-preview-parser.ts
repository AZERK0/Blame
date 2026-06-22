export type MarkdownPreviewBlock =
  | {
      code: string
      key: string
      type: "code"
    }
  | {
      key: string
      line: string
      lineIndex: number
      type: "line"
    }
  | {
      header: string[]
      key: string
      rows: string[][]
      type: "table"
    }

export function markdownPreviewBlocks(markdown: string) {
  const blocks: MarkdownPreviewBlock[] = []
  const lines = markdown.split("\n")
  let codeStart: number | undefined
  let codeLines: string[] = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]

    if (line.startsWith("```")) {
      if (codeStart === undefined) {
        codeStart = index
        codeLines = []
        continue
      }
      blocks.push({
        code: codeLines.join("\n"),
        key: `code-${codeStart}`,
        type: "code",
      })
      codeStart = undefined
      codeLines = []
      continue
    }

    if (codeStart !== undefined) {
      codeLines.push(line)
      continue
    }

    const table = markdownPreviewTable(lines, index)
    if (table) {
      blocks.push(table.block)
      index = table.end
      continue
    }

    blocks.push({
      key: `line-${index}-${line}`,
      line,
      lineIndex: index,
      type: "line",
    })
  }

  if (codeStart !== undefined) {
    blocks.push({
      code: codeLines.join("\n"),
      key: `code-${codeStart}`,
      type: "code",
    })
  }

  return blocks
}

function markdownPreviewTable(lines: string[], start: number) {
  const header = markdownTableCells(lines[start])
  if (!header || !markdownTableSeparator(lines[start + 1])) return
  const rows: string[][] = []
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
  const trimmed = line.trim()
  const content = trimmed.replace(/^\|/, "").replace(/\|$/, "")
  const cells = content.split("|").map((cell) => cell.trim())
  return cells.length > 1 ? cells : undefined
}

function markdownTableSeparator(line: string | undefined) {
  const cells = markdownTableCells(line)
  return Boolean(cells?.every((cell) => /^:?-{3,}:?$/.test(cell)))
}
