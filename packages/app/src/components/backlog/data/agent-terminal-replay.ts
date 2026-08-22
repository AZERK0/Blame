import { retryableBacklogError } from "./backlog-api.ts"
import type { useBacklogStore } from "./backlog-store.ts"
import {
  acknowledgeTerminalAgentUpdate,
  pendingTerminalAgentUpdates,
  type PersistableAgentUpdate,
  type TerminalAgentUpdate,
} from "./agent-terminal-outbox.ts"
import type { UserStory, UserStoryAgentRun } from "./backlog-data.ts"

export async function replayTerminalAgentUpdates(
  storage: Storage,
  backlog: ReturnType<typeof useBacklogStore>,
  persist: (
    story: UserStory,
    update: PersistableAgentUpdate
  ) => Promise<unknown>
) {
  const projectId = backlog.projectId
  if (!projectId) return
  const updates = pendingTerminalAgentUpdates(storage, projectId)
  for (const update of updates) {
    await replayTerminalAgentUpdate(storage, backlog, update, persist)
  }
}

async function replayTerminalAgentUpdate(
  storage: Storage,
  backlog: ReturnType<typeof useBacklogStore>,
  update: TerminalAgentUpdate,
  persist: (
    story: UserStory,
    update: PersistableAgentUpdate
  ) => Promise<unknown>
) {
  const story = backlog.stories.find((item) => item.id === update.storyId)
  if (!story) return acknowledgeTerminalAgentUpdate(storage, update)
  const detailedStory = await backlog.loadDetail(story)
  const run = detailedStory.agentRuns?.find((item) => item.id === update.runId)
  if (update.runId && !run) {
    return acknowledgeTerminalAgentUpdate(storage, update)
  }
  if (run && run.status !== "running") {
    return acknowledgeTerminalAgentUpdate(storage, update)
  }
  await persistReplay(storage, detailedStory, run, update, persist)
}

async function persistReplay(
  storage: Storage,
  story: UserStory,
  run: UserStoryAgentRun | undefined,
  update: TerminalAgentUpdate,
  persist: (
    story: UserStory,
    update: PersistableAgentUpdate
  ) => Promise<unknown>
) {
  try {
    await persist(story, replayableAgentUpdate(run, update))
    acknowledgeTerminalAgentUpdate(storage, update)
  } catch (error) {
    if (!retryableBacklogError(error)) {
      acknowledgeTerminalAgentUpdate(storage, update)
    }
    throw error
  }
}

function replayableAgentUpdate(
  run: UserStoryAgentRun | undefined,
  update: TerminalAgentUpdate
): PersistableAgentUpdate {
  return {
    activities: update.activities,
    input: update.input,
    run,
    runInput: update.runInput,
  }
}
