import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { relative, resolve, sep } from "node:path"
import { promisify } from "node:util"
import { ipcMain } from "electron"

const execFileAsync = promisify(execFile)

type WorkspacePathInput = {
  root: string
  path?: string
}

type WorkspaceSearchInput = WorkspacePathInput & {
  query: string
  limit?: number
}

export function registerWorkspaceIpcHandlers() {
  ipcMain.handle("workspace:list-directory", (_event, input: WorkspacePathInput) => listDirectory(input))
  ipcMain.handle("workspace:read-file", (_event, input: WorkspacePathInput) => readWorkspaceFile(input))
  ipcMain.handle("workspace:search-files", (_event, input: WorkspaceSearchInput) => searchFiles(input))
  ipcMain.handle("workspace:git-diff", (_event, input: { root: string }) => gitDiff(input.root))
}

async function listDirectory(input: WorkspacePathInput) {
  const directory = resolveWorkspacePath(input)
  const entries = await readdir(directory, { withFileTypes: true })
  return entries
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => ({
      name: entry.name,
      path: toWorkspacePath(input.root, resolve(directory, entry.name)),
      type: entry.isDirectory() ? "directory" : "file",
    }))
    .sort((left, right) => `${left.type}:${left.name}`.localeCompare(`${right.type}:${right.name}`))
}

async function readWorkspaceFile(input: WorkspacePathInput) {
  const filePath = resolveWorkspacePath(input)
  const fileStat = await stat(filePath)
  if (!fileStat.isFile()) throw new Error("Path is not a file")
  return readFile(filePath, "utf8")
}

async function searchFiles(input: WorkspaceSearchInput) {
  const root = resolve(input.root)
  const query = input.query.trim().toLowerCase()
  if (!query) return []
  const limit = Math.min(input.limit ?? 30, 100)
  const matches: Array<{ name: string; path: string; type: "file" }> = []
  await walk(root, root, query, limit, matches)
  return matches
}

async function gitDiff(root: string) {
  const cwd = resolve(root)
  const { stdout } = await execFileAsync("git", ["diff", "--no-ext-diff", "--"], { cwd })
  return stdout
}

async function walk(
  root: string,
  directory: string,
  query: string,
  limit: number,
  matches: Array<{ name: string; path: string; type: "file" }>
) {
  if (matches.length >= limit) return
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    if (matches.length >= limit || shouldSkip(entry.name)) continue
    const entryPath = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(root, entryPath, query, limit, matches)
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().includes(query)) {
      matches.push({ name: entry.name, path: toWorkspacePath(root, entryPath), type: "file" })
    }
  }
}

function resolveWorkspacePath(input: WorkspacePathInput) {
  const root = resolve(input.root)
  const target = resolve(root, input.path ?? ".")
  if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error("Path escapes workspace")
  return target
}

function toWorkspacePath(root: string, target: string) {
  const path = relative(resolve(root), target)
  return path || "."
}

function shouldSkip(name: string) {
  return [".git", "node_modules", "dist", "build", ".turbo"].includes(name)
}
