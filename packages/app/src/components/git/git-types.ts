import type { GitStatusFile } from "@/context/platform"

export type GitSelection =
  | {
      type: "commit"
      hash: string
    }
  | {
      type: "file"
      path: string
      staged: boolean
    }

export type GitFileGroup = {
  empty: string
  files: GitStatusFile[]
  id: "staged" | "workspace"
  staged: boolean
  title: string
}

export function gitSelectionKey(selection?: GitSelection) {
  if (!selection) return ""
  if (selection.type === "commit") return `commit:${selection.hash}`
  return `file:${selection.path}:${selection.staged ? "staged" : "workspace"}`
}

export function gitFileSelection(path: string, staged: boolean): GitSelection {
  return { type: "file", path, staged }
}

export function gitCommitSelection(hash: string): GitSelection {
  return { type: "commit", hash }
}
