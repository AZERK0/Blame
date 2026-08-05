import { parsePatchFiles } from "@pierre/diffs"

export type DiffCodeLine = {
  content: string
  newLineNumber?: number
  oldLineNumber?: number
}

export type ParsedVcsFileDiff = {
  additions?: number
  deletions?: number
  file: string
  patch?: string
  status: "added" | "deleted" | "modified" | string
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
  const hunks = parsePatchFiles(patch).flatMap((parsed) =>
    parsed.files.flatMap((file) => file.hunks)
  )
  let hunkIndex = 0
  let oldLineNumber = 0
  let newLineNumber = 0

  return patch.split("\n").map((content) => {
    if (content.startsWith("@@")) {
      const hunk = hunks[hunkIndex]
      hunkIndex += 1
      if (hunk) {
        oldLineNumber = hunk.deletionStart
        newLineNumber = hunk.additionStart
      }
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

export function parseGitDiff(diff: string): ParsedVcsFileDiff[] {
  return splitGitDiffFiles(diff)
    .map((patch) => {
      const file = parsePatchFiles(patch)[0]?.files[0]
      if (!file) return undefined

      return {
        additions: file.hunks.reduce(
          (total, hunk) => total + hunk.additionLines,
          0
        ),
        deletions: file.hunks.reduce(
          (total, hunk) => total + hunk.deletionLines,
          0
        ),
        file: file.name,
        patch,
        status:
          file.type === "new"
            ? "added"
            : file.type === "deleted"
              ? "deleted"
              : "modified",
      }
    })
    .filter((file): file is ParsedVcsFileDiff => Boolean(file))
}

function splitGitDiffFiles(diff: string) {
  return diff
    .split(/\ndiff --git /)
    .map((part, index) => (index === 0 ? part : `diff --git ${part}`))
    .filter((part) => part.startsWith("diff --git "))
}
