import type { UserStoryAgentActivity } from "../data/backlog-data.ts"

const parallelToolStartWindowMs = 500

export type UserStoryActivityNode =
  | {
      activity: UserStoryAgentActivity
      id: string
      type: "activity"
    }
  | {
      activities: UserStoryAgentActivity[]
      children: UserStoryActivityNode[]
      id: string
      type: "group"
    }

export function userStoryActivityTree(
  activities: UserStoryAgentActivity[]
): UserStoryActivityNode[] {
  const nodes: UserStoryActivityNode[] = []
  let index = 0

  while (index < activities.length) {
    const activity = activities[index]
    if (!activity) break
    const batch = parallelToolBatch(activities, index)
    if (batch.length > 1) {
      nodes.push(activityGroup(batch))
      index += batch.length
      continue
    }
    nodes.push(activityNode(activity))
    index += 1
  }

  return nodes
}

function parallelToolBatch(
  activities: UserStoryAgentActivity[],
  start: number
) {
  const first = activities[start]
  if (first?.kind !== "tool") return []
  if (first.parallelGroupId) return explicitParallelBatch(activities, start)
  return legacyParallelBatch(activities, start)
}

function explicitParallelBatch(
  activities: UserStoryAgentActivity[],
  start: number
) {
  const first = activities[start]
  if (!first?.parallelGroupId) return []
  const batch: UserStoryAgentActivity[] = []
  for (let index = start; index < activities.length; index += 1) {
    const activity = activities[index]
    if (activity?.parallelGroupId !== first.parallelGroupId) break
    batch.push(activity)
  }
  return batch
}

function legacyParallelBatch(
  activities: UserStoryAgentActivity[],
  start: number
) {
  const first = activities[start]
  if (!first) return []
  const batch: UserStoryAgentActivity[] = []
  for (let index = start; index < activities.length; index += 1) {
    const activity = activities[index]
    if (!belongsToLegacyBatch(first, activity)) break
    batch.push(activity)
  }
  return batch
}

function belongsToLegacyBatch(
  first: UserStoryAgentActivity,
  activity: UserStoryAgentActivity | undefined
): activity is UserStoryAgentActivity {
  if (activity?.kind !== "tool") return false
  if (activity.parallelGroupId) return false
  if (!sameIteration(first.iteration, activity.iteration)) return false
  return startedTogether(first, activity)
}

function sameIteration(left: number | undefined, right: number | undefined) {
  if (left !== undefined || right !== undefined) return left === right
  return true
}

function startedTogether(
  first: UserStoryAgentActivity,
  activity: UserStoryAgentActivity
) {
  const firstStartedAt = timestamp(first.createdAt)
  const activityStartedAt = timestamp(activity.createdAt)
  if (firstStartedAt === undefined || activityStartedAt === undefined) {
    return false
  }
  return activityStartedAt - firstStartedAt <= parallelToolStartWindowMs
}

function activityGroup(
  activities: UserStoryAgentActivity[]
): UserStoryActivityNode {
  const first = activities[0]
  return {
    activities,
    children: activities.map(activityNode),
    id:
      first?.parallelGroupId ??
      `parallel-tools-${first?.iteration ?? "legacy"}-${first?.id}`,
    type: "group",
  }
}

function activityNode(activity: UserStoryAgentActivity): UserStoryActivityNode {
  return {
    activity,
    id: activity.id,
    type: "activity",
  }
}

function timestamp(value: string) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : timestamp
}
