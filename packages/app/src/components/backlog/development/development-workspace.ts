import * as React from "react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"

export type DevelopmentDiffKind = "add" | "del" | "mix"
export type DevelopmentFileTab = {
  path: string
}
export type FileNode = {
  absolute?: string
  ignored?: boolean
  name: string
  path: string
  type: "directory" | "file"
}
export type FileContent = {
  content: string
  diff?: string
  encoding?: string
  mimeType?: string
  type?: string
}
export type VcsFileDiff = {
  file: string
  status: "added" | "deleted" | "modified" | string
  additions?: number
  deletions?: number
  patch?: string
  hunks?: unknown[]
}

export function useDevelopmentWorkspace(
  userStory?: UserStory,
  fallbackToProjectRoot?: boolean
) {
  const platform = usePlatform()
  const projects = useProjects()
  const [reloadKey, setReloadKey] = React.useState(0)
  const directory =
    userStory?.worktree ??
    (fallbackToProjectRoot ? projects.activeProject?.path : undefined)

  const listDirectory = React.useCallback(
    async (path: string) => {
      if (!directory || !platform.workspace) return []
      const nodes = await platform.workspace.listDirectory({ root: directory, path })
      return normalizeNodes(nodes)
    },
    [directory, platform.workspace]
  )

  const readFile = React.useCallback(
    async (path: string) => {
      if (!directory || !platform.workspace) return undefined
      return { content: await platform.workspace.readFile({ root: directory, path }) }
    },
    [directory, platform.workspace]
  )

  const loadDiffs = React.useCallback(async () => {
    if (!directory || !platform.workspace) return []
    return normalizeDiffs(parseGitDiff(await platform.workspace.gitDiff({ root: directory })))
  }, [directory, platform.workspace])

  React.useEffect(() => {
    if (!directory) return
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      setReloadKey((current) => current + 1)
    }, 1_500)
    return () => clearInterval(timer)
  }, [directory])

  return {
    available: Boolean(directory && platform.workspace),
    hasServer: Boolean(platform.workspace),
    worktree: directory,
    listDirectory,
    readFile,
    loadDiffs,
    reloadKey,
  }
}

export function normalizePath(path: string) {
  return path.replaceAll("\\", "/").replace(/^\/+/, "").replace(/\/+$/, "")
}

export function filename(path: string) {
  const normalized = normalizePath(path)
  const index = normalized.lastIndexOf("/")
  return index === -1 ? normalized : normalized.slice(index + 1)
}

export function buildDiffKinds(diffs: VcsFileDiff[]) {
  const merge = (
    current: DevelopmentDiffKind | undefined,
    next: DevelopmentDiffKind
  ) => {
    if (!current) return next
    if (current === next) return current
    return "mix" as const
  }

  return diffs.reduce((items, diff) => {
    const path = normalizePath(diff.file)
    const kind = diff.status === "added" ? "add" : diff.status === "deleted" ? "del" : "mix"
    items.set(path, kind)
    parents(path).forEach((parent) => items.set(parent, merge(items.get(parent), kind)))
    return items
  }, new Map<string, DevelopmentDiffKind>())
}

export function diffKindLabel(kind: DevelopmentDiffKind) {
  if (kind === "add") return "A"
  if (kind === "del") return "D"
  return "M"
}

export function diffKindClassName(kind: DevelopmentDiffKind) {
  if (kind === "add") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  if (kind === "del") return "border-destructive/30 bg-destructive/10 text-destructive"
  return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
}

export function normalizeNodes(nodes: FileNode[]) {
  return nodes
    .map((node) => ({ ...node, path: normalizePath(node.path) }))
    .sort(sortNodes)
}

export function normalizeDiffs(diffs: VcsFileDiff[]) {
  return diffs
    .map((diff) => ({ ...diff, file: normalizePath(diff.file) }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

function sortNodes(a: FileNode, b: FileNode) {
  if (a.type !== b.type) return a.type === "directory" ? -1 : 1
  return a.name.localeCompare(b.name)
}

function parents(path: string) {
  return path
    .split("/")
    .slice(0, -1)
    .map((_, index, parts) => parts.slice(0, index + 1).join("/"))
    .filter(Boolean)
}

function parseGitDiff(diff: string): VcsFileDiff[] {
  return diff
    .split(/\ndiff --git /)
    .map((part, index) => (index === 0 ? part : `diff --git ${part}`))
    .filter((part) => part.startsWith("diff --git "))
    .map(parseGitDiffFile)
    .filter((file): file is VcsFileDiff => Boolean(file))
}

function parseGitDiffFile(patch: string): VcsFileDiff | undefined {
  const file = patch.match(/^diff --git a\/(.+?) b\/(.+)$/m)
  if (!file) return undefined
  const deleted = /^deleted file mode /m.test(patch)
  const added = /^new file mode /m.test(patch)
  return {
    file: deleted ? file[1] : file[2],
    status: added ? "added" : deleted ? "deleted" : "modified",
    additions: countDiffLines(patch, "+"),
    deletions: countDiffLines(patch, "-"),
    patch,
  }
}

function countDiffLines(patch: string, marker: "+" | "-") {
  const forbidden = marker === "+" ? "+++" : "---"
  return patch
    .split("\n")
    .filter((line) => line.startsWith(marker) && !line.startsWith(forbidden))
    .length
}

export type DevelopmentFileContent = FileContent | undefined
