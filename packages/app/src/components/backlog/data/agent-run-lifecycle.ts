import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryAgentRunFinalization,
  UserStoryAgentRunUpdate,
  UserStoryUpdate,
} from "./backlog-data.ts"
import type { AgentEvent } from "@blame/agent-runtime"

export function agentEventMatchesExecution(
  event: AgentEvent,
  executionId: string | undefined
) {
  return !executionId || event.executionId === executionId
}

export function agentRunOwnsStory(
  story: UserStory,
  run: UserStoryAgentRun | undefined
) {
  if (!run) return true
  if (story.activeAgentRunId !== undefined) {
    return story.activeAgentRunId === run.id
  }
  return (
    story.agentRuns?.findLast((candidate) => candidate.status === "running")
      ?.id === run.id
  )
}

export function agentUpdateKey(
  story: UserStory,
  run: UserStoryAgentRun | undefined
) {
  return run?.id ?? story.id
}

export function agentRunFinalization(
  activities: UserStoryAgentActivity[],
  storyInput: UserStoryUpdate,
  runInput: UserStoryAgentRunUpdate,
  outcome: UserStoryAgentRunFinalization["outcome"] = "review"
): UserStoryAgentRunFinalization | undefined {
  if (
    runInput.status !== "completed" &&
    runInput.status !== "failed" &&
    runInput.status !== "cancelled"
  ) {
    return undefined
  }
  return {
    activities: terminalActivities(activities, runInput.completedAt),
    agentLastError: storyInput.agentLastError,
    agentLastEvent: storyInput.agentLastEvent,
    completedAt: runInput.completedAt,
    diffEndRef: runInput.diffEndRef,
    finalResponse: runInput.finalResponse ?? storyInput.agentFinalResponse,
    outcome,
    ...(runInput.persistenceEvent
      ? { persistenceEvent: runInput.persistenceEvent }
      : {}),
    sessionSummary: runInput.sessionSummary ?? storyInput.agentSessionSummary,
    status: runInput.status,
    usage: runInput.usage ?? storyInput.agentUsage,
  }
}

function terminalActivities(
  activities: UserStoryAgentActivity[],
  completedAt: string | null | undefined
) {
  return activities.map((activity) => {
    if (activity.status !== "running") return activity
    return {
      ...activity,
      status: terminalActivityStatus(activity.kind),
      ...(completedAt ? { updatedAt: completedAt } : {}),
    }
  })
}

function terminalActivityStatus(kind: UserStoryAgentActivity["kind"]) {
  return kind === "tool" || kind === "approval" || kind === "error"
    ? ("failed" as const)
    : ("completed" as const)
}
