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

export function markdownPreviewBlocks(markdown: string) {
  const blocks: MarkdownPreviewBlock[] = []
  const lines = markdown.split("\n")
  let codeStart: number | undefined
  let codeLines: string[] = []

  lines.forEach((line, index) => {
    if (line.startsWith("```")) {
      if (codeStart === undefined) {
        codeStart = index
        codeLines = []
        return
      }
      blocks.push({
        code: codeLines.join("\n"),
        key: `code-${codeStart}`,
        type: "code",
      })
      codeStart = undefined
      codeLines = []
      return
    }

    if (codeStart !== undefined) {
      codeLines.push(line)
      return
    }

    blocks.push({
      key: `line-${index}-${line}`,
      line,
      lineIndex: index,
      type: "line",
    })
  })

  if (codeStart !== undefined) {
    blocks.push({
      code: codeLines.join("\n"),
      key: `code-${codeStart}`,
      type: "code",
    })
  }

  return blocks
}
