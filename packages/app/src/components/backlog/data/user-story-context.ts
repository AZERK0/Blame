import type {
  UserStory,
  UserStoryFileAttachment,
} from "@/components/backlog/data/backlog-data"

export function completedStoryContextAttachment(
  story: UserStory,
  changedFiles: string[] = []
): UserStoryFileAttachment {
  const markdown = completedStoryContextMarkdown(story, changedFiles)
  const bytes = new TextEncoder().encode(markdown)
  return {
    aiContextMarkdown: markdown,
    content: base64(bytes),
    id: crypto.randomUUID(),
    name: `context-from-us-${story.id}.md`,
    size: bytes.length,
    type: "text/markdown",
  }
}

export function completedStoryContextMarkdown(
  story: UserStory,
  changedFiles: string[] = []
) {
  return [
    `# Context from completed User Story #${story.id}`,
    "",
    "## Source",
    `Title: ${available(story.title)}`,
    "Status: Done",
    `Merged at: ${available(story.mergedAt)}`,
    `Branch: ${available(story.branch)}`,
    `Base commit: ${available(story.baseCommit)}`,
    `Merge commit: ${available(story.mergeCommit)}`,
    "",
    "## Original request",
    availableBlock(story.summary),
    "",
    "## Session summary",
    availableContextBlock(story.agentSessionSummary, story, changedFiles),
    "",
    "## Final agent response",
    availableContextBlock(story.agentFinalResponse, story, changedFiles),
    "",
    "## Technical reference",
    changedFilesMarkdown(changedFiles),
  ].join("\n")
}

export function changedFilesFromDiff(diff: string) {
  return Array.from(diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm))
    .map((match) => match[2] ?? match[1])
    .filter(Boolean)
}

function changedFilesMarkdown(changedFiles: string[]) {
  if (!changedFiles.length) return "Files changed: Not available."
  return ["Files changed:", ...changedFiles.map((file) => `- ${file}`)].join(
    "\n"
  )
}

function available(value: string | null | undefined) {
  return value?.trim() || "Not available."
}

function availableBlock(value: string | null | undefined) {
  return available(value)
}

function availableContextBlock(
  value: string | null | undefined,
  story: UserStory,
  changedFiles: string[]
) {
  return cleanContextPaths(available(value), story, changedFiles)
}

function cleanContextPaths(
  value: string,
  story: UserStory,
  changedFiles: string[]
) {
  return value
    .replace(pathPattern(), (token) =>
      cleanPathToken(token, story, changedFiles)
    )
    .trim()
}

function cleanPathToken(
  token: string,
  story: UserStory,
  changedFiles: string[]
) {
  const [path, suffix] = splitPathSuffix(token)
  const fromWorktree = stripStoryWorktreePath(path, story)
  if (fromWorktree !== path) return `${fromWorktree}${suffix}`
  const fromRuntime = stripRuntimeWorktreePath(path)
  if (fromRuntime !== path) return `${fromRuntime}${suffix}`
  const fromChangedFiles = stripChangedFilePath(path, changedFiles)
  return `${fromChangedFiles}${suffix}`
}

function splitPathSuffix(value: string): [string, string] {
  const match = value.match(/^(.+?)([.,;:]+)?$/)
  return [match?.[1] ?? value, match?.[2] ?? ""]
}

function stripStoryWorktreePath(path: string, story: UserStory) {
  const root = story.worktree?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (!root) return path
  const normalized = path.replaceAll("\\", "/")
  if (!normalized.startsWith(`${root}/`)) return path
  return normalized.slice(root.length + 1)
}

function stripRuntimeWorktreePath(path: string) {
  const normalized = path.replaceAll("\\", "/")
  const marker = "/.local/share/blame/runtime/worktrees/"
  const index = normalized.indexOf(marker)
  if (index === -1) return path
  const rest = normalized.slice(index + marker.length).split("/")
  if (rest.length < 3) return path
  return rest.slice(2).join("/")
}

function stripChangedFilePath(path: string, changedFiles: string[]) {
  const normalized = path.replaceAll("\\", "/")
  const changedFile = changedFiles.find((file) =>
    normalized.endsWith(`/${file}`)
  )
  return changedFile ?? path
}

function pathPattern() {
  return /(?:[A-Za-z]:)?[\\/][^\s`'")\]]+/g
}

function base64(bytes: Uint8Array) {
  let binary = ""
  const chunkSize = 8192
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize))
  }
  return btoa(binary)
}
