import type { VcsFileDiff } from "@/components/backlog/development/development-workspace"

export type DevelopmentGraphDiff = Pick<
  VcsFileDiff,
  "additions" | "deletions" | "file" | "status"
>

export type DevelopmentGraphNodeData = {
  additions?: number
  deletions?: number
  id: string
  label: string
  nodeType: "directory" | "file"
  parent?: string
  path: string
  status?: string
}

export type DevelopmentGraphElement =
  | {
      data: DevelopmentGraphNodeData
      group: "nodes"
    }
  | {
      data: {
        id: string
        source: string
        target: string
      }
      group: "edges"
    }

export function buildDevelopmentGraphElements(diffs: DevelopmentGraphDiff[]) {
  const directories = new Set<string>()
  const elements: DevelopmentGraphElement[] = []

  for (const diff of diffs) {
    const path = normalizeGraphPath(diff.file)
    if (!path) continue

    const parts = path.split("/")
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"))
    }
  }

  for (const path of [...directories].sort()) {
    elements.push({
      data: {
        id: directoryId(path),
        label: lastPathSegment(path),
        nodeType: "directory",
        path,
        ...(parentDirectory(path) ? { parent: parentDirectory(path) } : {}),
      },
      group: "nodes",
    })
  }

  for (const diff of diffs) {
    const path = normalizeGraphPath(diff.file)
    if (!path) continue

    elements.push({
      data: {
        id: fileIdFor(path),
        label: lastPathSegment(path),
        nodeType: "file",
        path,
        status: diff.status,
        ...(diff.additions === undefined ? {} : { additions: diff.additions }),
        ...(diff.deletions === undefined ? {} : { deletions: diff.deletions }),
        ...(parentDirectory(path) ? { parent: parentDirectory(path) } : {}),
      },
      group: "nodes",
    })
  }

  return elements
}

export function fileIdFor(path: string) {
  return `file:${normalizeGraphPath(path)}`
}

function directoryId(path: string) {
  return `directory:${path}`
}

function lastPathSegment(path: string) {
  const index = path.lastIndexOf("/")
  return index === -1 ? path : path.slice(index + 1)
}

function normalizeGraphPath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "")
}

function parentDirectory(path: string) {
  const index = path.lastIndexOf("/")
  return index === -1 ? undefined : directoryId(path.slice(0, index))
}
