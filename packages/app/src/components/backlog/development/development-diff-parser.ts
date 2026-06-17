export type DiffCodeLine = {
  content: string
  newLineNumber?: number
  oldLineNumber?: number
}

export function diffLineKind(line: string) {
  if (line.startsWith("@@")) return "hunk"
  if (line.startsWith("+++") || line.startsWith("---")) return "meta"
  if (line.startsWith("+")) return "add"
  if (line.startsWith("-")) return "del"
  if (line.startsWith("diff ") || line.startsWith("index ")) return "meta"
  return "context"
}

export function diffLines(patch: string): DiffCodeLine[] {
  let oldLineNumber = 0
  let newLineNumber = 0

  return patch.split("\n").map((content) => {
    const hunk = hunkLineNumbers(content)
    if (hunk) {
      oldLineNumber = hunk.oldStart
      newLineNumber = hunk.newStart
      return { content }
    }

    if (diffLineKind(content) === "meta") return { content }

    if (content.startsWith("-")) {
      const line = { content, oldLineNumber }
      oldLineNumber += 1
      return line
    }

    if (content.startsWith("+")) {
      const line = { content, newLineNumber }
      newLineNumber += 1
      return line
    }

    const line = { content, oldLineNumber, newLineNumber }
    oldLineNumber += 1
    newLineNumber += 1
    return line
  })
}

function hunkLineNumbers(line: string) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  if (!match) return undefined
  return {
    newStart: Number(match[2]),
    oldStart: Number(match[1]),
  }
}
