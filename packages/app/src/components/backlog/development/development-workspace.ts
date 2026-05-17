import * as React from "react"
import type { FileContent, FileNode, VcsFileDiff } from "@opencode-ai/sdk/v2"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { useProjects } from "@/context/projects"
import { useServer } from "@/context/server"
import { createSdkForServer } from "@/lib/opencode-client"

export type DevelopmentDiffKind = "add" | "del" | "mix"
export type DevelopmentFileTab = {
  path: string
}

export function useDevelopmentWorkspace(
  userStory?: UserStory,
  fallbackToProjectRoot?: boolean
) {
  const server = useServer()
  const projects = useProjects()
  const [reloadKey, setReloadKey] = React.useState(0)
  const directory =
    userStory?.worktree ??
    (fallbackToProjectRoot ? projects.activeProject?.path : undefined)
  const client = React.useMemo(
    () => (server.server ? createSdkForServer(server.server) : undefined),
    [server.server]
  )

  const listDirectory = React.useCallback(
    async (path: string) => {
      if (!client || !directory) return []
      const result = await client.file.list({
        directory,
        path,
      })
      return normalizeNodes(result.data ?? [])
    },
    [client, directory]
  )

  const readFile = React.useCallback(
    async (path: string) => {
      if (!client || !directory) return undefined
      const result = await client.file.read({
        directory,
        path,
      })
      return result.data
    },
    [client, directory]
  )

  const loadDiffs = React.useCallback(async () => {
    if (!client || !directory) return []
    const result = await client.vcs.diff({
      directory,
      mode: "git",
    })
    return normalizeDiffs(result.data ?? [])
  }, [client, directory])

  React.useEffect(() => {
    if (!client || !directory) return
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const scheduleReload = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        setReloadKey((current) => current + 1)
      }, 80)
    }
    const watch = async () => {
      while (!abort.signal.aborted) {
        try {
          const events = await client.event.subscribe(
            { directory },
            { signal: abort.signal }
          )
          for await (const event of events.stream) {
            if (!isFileUpdateEvent(event)) continue
            if (normalizePath(event.properties.file).startsWith(".git/")) continue
            scheduleReload()
          }
        } catch (error) {
          if (abort.signal.aborted) return
          console.error("[development-workspace] file watcher failed", error)
        }
        await waitForReconnect(abort.signal)
      }
    }
    void watch()
    return () => {
      abort.abort()
      if (timer) clearTimeout(timer)
    }
  }, [client, directory])

  React.useEffect(() => {
    if (!client || !directory) return
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return
      setReloadKey((current) => current + 1)
    }, 1_500)
    return () => clearInterval(timer)
  }, [client, directory])

  return {
    available: Boolean(client && directory),
    hasServer: Boolean(client),
    worktree: directory,
    listDirectory,
    readFile,
    loadDiffs,
    reloadKey,
  }
}

function waitForReconnect(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 250)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

function isFileUpdateEvent(event: unknown): event is {
  properties: { file: string }
  type: "file.edited" | "file.watcher.updated"
} {
  if (!event || typeof event !== "object") return false
  if (!("type" in event) || !("properties" in event)) return false
  const type = event.type
  if (type !== "file.watcher.updated" && type !== "file.edited") return false
  const properties = event.properties
  if (!properties || typeof properties !== "object") return false
  return "file" in properties && typeof properties.file === "string"
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

function normalizeNodes(nodes: FileNode[]) {
  return nodes
    .map((node) => ({ ...node, path: normalizePath(node.path) }))
    .sort(sortNodes)
}

function normalizeDiffs(diffs: VcsFileDiff[]) {
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

export type DevelopmentFileContent = FileContent | undefined
