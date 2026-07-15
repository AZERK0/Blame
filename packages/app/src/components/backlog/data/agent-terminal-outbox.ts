import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryAgentRunUpdate,
  UserStoryUpdate,
} from "./backlog-data.ts"

const storageKey = "blame:agent-terminal-updates:v1"

export type PersistableAgentUpdate = {
  activities: UserStoryAgentActivity[]
  input: UserStoryUpdate
  run?: UserStoryAgentRun
  runInput: UserStoryAgentRunUpdate
}

export type TerminalAgentUpdate = Omit<PersistableAgentUpdate, "run"> & {
  createdAt: string
  id: string
  projectId: string
  revision: string
  runId?: string
  storyId: string
}

export async function persistTerminalAgentUpdate(
  storage: Storage,
  story: UserStory,
  update: PersistableAgentUpdate,
  persist: () => Promise<unknown>
) {
  const terminalUpdate = createTerminalAgentUpdate(story, update)
  if (!terminalUpdate) return persist()
  enqueueTerminalAgentUpdate(storage, terminalUpdate)
  const result = await persist()
  acknowledgeTerminalAgentUpdate(storage, terminalUpdate)
  return result
}

export function pendingTerminalAgentUpdates(
  storage: Storage,
  projectId: string
) {
  return readTerminalAgentUpdates(storage).filter(
    (update) => update.projectId === projectId
  )
}

export function acknowledgeTerminalAgentUpdate(
  storage: Storage,
  completed: Pick<TerminalAgentUpdate, "id" | "revision">
) {
  const updates = readTerminalAgentUpdates(storage)
  const current = updates.find((update) => update.id === completed.id)
  if (current?.revision !== completed.revision) return
  writeTerminalAgentUpdates(
    storage,
    updates.filter((update) => update.id !== completed.id)
  )
}

function createTerminalAgentUpdate(
  story: UserStory,
  update: PersistableAgentUpdate
): TerminalAgentUpdate | undefined {
  if (!terminalRunUpdate(update.runInput)) return undefined
  return {
    activities: update.activities,
    createdAt: new Date().toISOString(),
    id: `${story.projectId}:${story.id}:${update.run?.id ?? "story"}`,
    input: update.input,
    projectId: story.projectId,
    revision: crypto.randomUUID(),
    runId: update.run?.id,
    runInput: update.runInput,
    storyId: story.id,
  }
}

function terminalRunUpdate(input: UserStoryAgentRunUpdate) {
  return input.status === "completed" || input.status === "failed"
}

function enqueueTerminalAgentUpdate(
  storage: Storage,
  update: TerminalAgentUpdate
) {
  const updates = readTerminalAgentUpdates(storage).filter(
    (current) => current.id !== update.id
  )
  writeTerminalAgentUpdates(storage, [...updates, update])
}

function readTerminalAgentUpdates(storage: Storage) {
  try {
    const value = JSON.parse(storage.getItem(storageKey) ?? "[]")
    return Array.isArray(value) ? value.filter(terminalAgentUpdate) : []
  } catch {
    return []
  }
}

function writeTerminalAgentUpdates(
  storage: Storage,
  updates: TerminalAgentUpdate[]
) {
  storage.setItem(storageKey, JSON.stringify(updates))
}

function terminalAgentUpdate(value: unknown): value is TerminalAgentUpdate {
  if (!value || typeof value !== "object") return false
  const update = value as Partial<TerminalAgentUpdate>
  return (
    typeof update.id === "string" &&
    typeof update.projectId === "string" &&
    typeof update.revision === "string" &&
    typeof update.storyId === "string" &&
    Array.isArray(update.activities) &&
    Boolean(update.input) &&
    Boolean(update.runInput)
  )
}
