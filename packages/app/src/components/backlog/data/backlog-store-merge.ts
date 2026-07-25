import type {
  UserStory,
  UserStoryAgentRun,
  UserStoryComment,
  UserStoryFileAttachment,
} from "./backlog-data.ts"
import { mergeAgentActivities } from "./agent-activity-merge.ts"

export function mergeLoadedStories(
  currentStories: UserStory[],
  loadedStories: UserStory[]
) {
  const currentById = new Map(currentStories.map((story) => [story.id, story]))
  return loadedStories.map((story) => {
    const currentStory = currentById.get(story.id)
    return currentStory ? mergeUserStory(currentStory, story) : story
  })
}

export function mergeUserStory(
  currentStory: UserStory,
  serverStory: UserStory,
  options: { replaceAgentActivities?: boolean } = {}
) {
  const newestStory = newestValue(currentStory, serverStory)
  return {
    ...newestStory,
    agentActivities: options.replaceAgentActivities
      ? serverStory.agentActivities
      : mergeAgentActivities(
          currentStory.agentActivities ?? [],
          serverStory.agentActivities ?? []
        ),
    agentFinalResponse: providedValue(
      newestStory.agentFinalResponse,
      currentStory.agentFinalResponse
    ),
    agentRuns: mergeAgentRuns(
      currentStory.agentRuns ?? [],
      serverStory.agentRuns ?? []
    ),
    agentSessionSummary: providedValue(
      newestStory.agentSessionSummary,
      currentStory.agentSessionSummary
    ),
    agentUsage: providedValue(newestStory.agentUsage, currentStory.agentUsage),
    codeSelectionAttachments: providedValue(
      newestStory.codeSelectionAttachments,
      currentStory.codeSelectionAttachments
    ),
    comments: mergeComments(
      currentStory.comments ?? [],
      serverStory.comments ?? []
    ),
    fileAttachments: preserveLocalAttachmentContent(
      currentStory.fileAttachments,
      providedValue(
        newestStory.fileAttachments,
        currentStory.fileAttachments
      )
    ),
    ...localAttachmentUpload(currentStory),
  }
}

function localAttachmentUpload(story: UserStory): Partial<UserStory> {
  if (!story.fileAttachmentUploadStatus) return {}
  return {
    fileAttachments: story.fileAttachments,
    fileAttachmentUploadError: story.fileAttachmentUploadError,
    fileAttachmentUploadStatus: story.fileAttachmentUploadStatus,
  }
}

function preserveLocalAttachmentContent(
  currentAttachments: UserStoryFileAttachment[] | null | undefined,
  nextAttachments: UserStoryFileAttachment[] | null | undefined
) {
  if (!currentAttachments || !nextAttachments) return nextAttachments
  const localContentById = new Map(
    currentAttachments
      .filter((attachment) => attachment.content !== undefined)
      .map((attachment) => [attachment.id, attachment.content])
  )
  return nextAttachments.map((attachment) => {
    const content = localContentById.get(attachment.id)
    return content === undefined ? attachment : { ...attachment, content }
  })
}

export function mergeStoryAgentRun(
  story: UserStory,
  serverRun: UserStoryAgentRun
) {
  const currentRuns = story.agentRuns ?? []
  const currentRun = currentRuns.find((run) => run.id === serverRun.id)
  const nextRun = currentRun ? mergeAgentRun(currentRun, serverRun) : serverRun
  return {
    ...story,
    agentRuns: currentRun
      ? currentRuns.map((run) => (run.id === serverRun.id ? nextRun : run))
      : sortedByCreatedAt([...currentRuns, nextRun]),
  }
}

function mergeComments(
  currentComments: UserStoryComment[],
  serverComments: UserStoryComment[]
) {
  return sortedByCreatedAt(mergeById(currentComments, serverComments))
}

function mergeAgentRuns(
  currentRuns: UserStoryAgentRun[],
  serverRuns: UserStoryAgentRun[]
) {
  const runs = new Map(currentRuns.map((run) => [run.id, run]))
  serverRuns.forEach((serverRun) => {
    const currentRun = runs.get(serverRun.id)
    runs.set(
      serverRun.id,
      currentRun ? mergeAgentRun(currentRun, serverRun) : serverRun
    )
  })
  return sortedByCreatedAt([...runs.values()])
}

function mergeAgentRun(
  currentRun: UserStoryAgentRun,
  serverRun: UserStoryAgentRun
) {
  const newestRun = newestValue(currentRun, serverRun)
  return {
    ...newestRun,
    activities: mergeAgentActivities(
      currentRun.activities ?? [],
      serverRun.activities ?? []
    ),
    finalResponse: newestDefined(
      newestRun.finalResponse,
      currentRun.finalResponse,
      serverRun.finalResponse
    ),
    sessionSummary: newestDefined(
      newestRun.sessionSummary,
      currentRun.sessionSummary,
      serverRun.sessionSummary
    ),
    usage: newestDefined(newestRun.usage, currentRun.usage, serverRun.usage),
  }
}

function newestDefined<T>(...values: (T | null | undefined)[]) {
  return values.find((value) => value !== null && value !== undefined) ?? null
}

function providedValue<T>(value: T | undefined, fallback: T | undefined) {
  return value === undefined ? fallback : value
}

function mergeById<T extends { id: number | string }>(
  currentItems: T[],
  serverItems: T[]
) {
  const items = new Map(currentItems.map((item) => [item.id, item]))
  serverItems.forEach((item) => items.set(item.id, item))
  return [...items.values()]
}

function newestValue<T extends { updatedAt?: string | null }>(
  currentValue: T,
  serverValue: T
) {
  const currentUpdatedAt = timestamp(currentValue.updatedAt)
  const serverUpdatedAt = timestamp(serverValue.updatedAt)
  if (serverUpdatedAt === undefined) return currentValue
  if (currentUpdatedAt === undefined || serverUpdatedAt >= currentUpdatedAt) {
    return serverValue
  }
  return currentValue
}

function sortedByCreatedAt<T extends { createdAt: string }>(items: T[]) {
  return [...items].sort(
    (left, right) =>
      (timestamp(left.createdAt) ?? 0) - (timestamp(right.createdAt) ?? 0)
  )
}

function timestamp(value: string | null | undefined) {
  if (!value) return undefined
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : date
}
