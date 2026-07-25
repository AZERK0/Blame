import type { UserStory } from "@/components/backlog/data/backlog-data"

export function equalUserStoryCardStory(
  previous: UserStory,
  next: UserStory
) {
  if (previous === next) return true
  const previousStable = stableUserStoryCardFields(previous)
  const nextStable = stableUserStoryCardFields(next)
  const keys = Object.keys(nextStable) as (keyof typeof nextStable)[]
  return (
    keys.length === Object.keys(previousStable).length &&
    keys.every((key) => previousStable[key] === nextStable[key])
  )
}

function stableUserStoryCardFields(story: UserStory) {
  const {
    agentActivities,
    agentFinalResponse,
    agentLastEvent,
    agentRuns,
    agentSessionSummary,
    agentUsage,
    runningAgentRuns,
    ...stable
  } = story
  void agentActivities
  void agentFinalResponse
  void agentLastEvent
  void agentRuns
  void agentSessionSummary
  void agentUsage
  void runningAgentRuns
  return stable
}
