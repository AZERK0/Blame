import type { useBacklogStore } from "./backlog-store.ts"
import {
  acknowledgeTerminalAgentUpdate,
  pendingTerminalAgentUpdates,
  type PersistableAgentUpdate,
  type TerminalAgentUpdate,
} from "./agent-terminal-outbox.ts"
import type { UserStory, UserStoryAgentRun } from "./backlog-data.ts"

type PersistTerminalUpdate = (
  story: UserStory,
  update: PersistableAgentUpdate
) => Promise<unknown>
type TerminalUpdateAcknowledged = (
  story: UserStory,
  run?: UserStoryAgentRun
) => void

export async function replayTerminalAgentUpdates(
  storage: Storage,
  backlog: ReturnType<typeof useBacklogStore>,
  persist: PersistTerminalUpdate,
  onAcknowledged?: TerminalUpdateAcknowledged
) {
  const projectId = backlog.projectId
  if (!projectId) return
  const updates = pendingTerminalAgentUpdates(storage, projectId)
  for (const update of updates) {
    await replayTerminalAgentUpdate(
      storage,
      backlog,
      update,
      persist,
      onAcknowledged
    )
  }
}

async function replayTerminalAgentUpdate(
  storage: Storage,
  backlog: ReturnType<typeof useBacklogStore>,
  update: TerminalAgentUpdate,
  persist: PersistTerminalUpdate,
  onAcknowledged?: TerminalUpdateAcknowledged
) {
  const story = backlog.stories.find((item) => item.id === update.storyId)
  if (!story) return acknowledgeTerminalAgentUpdate(storage, update)
  const detailedStory = await backlog.loadDetail(story)
  const run = detailedStory.agentRuns?.find((item) => item.id === update.runId)
  if (update.runId && !run) {
    return acknowledgeTerminalAgentUpdate(storage, update)
  }
  if (run && run.status !== "running") {
    acknowledgeTerminalAgentUpdate(storage, update)
    onAcknowledged?.(detailedStory, run)
    return
  }
  await persistReplay(
    storage,
    detailedStory,
    run,
    update,
    persist,
    onAcknowledged
  )
}

async function persistReplay(
  storage: Storage,
  story: UserStory,
  run: UserStoryAgentRun | undefined,
  update: TerminalAgentUpdate,
  persist: PersistTerminalUpdate,
  onAcknowledged?: TerminalUpdateAcknowledged
) {
  await persist(story, replayableAgentUpdate(run, update))
  acknowledgeTerminalAgentUpdate(storage, update)
  onAcknowledged?.(story, run)
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
