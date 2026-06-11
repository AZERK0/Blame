import type { UserStoryAgentActivity } from "../data/backlog-data.ts"

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
  if (!isGroupedTool(first)) return []
  const batch: UserStoryAgentActivity[] = []
  for (let index = start; index < activities.length; index += 1) {
    const activity = activities[index]
    if (!isGroupedTool(activity) || activity.iteration !== first.iteration) {
      break
    }
    batch.push(activity)
  }
  return batch
}

function isGroupedTool(
  activity: UserStoryAgentActivity | undefined
): activity is UserStoryAgentActivity {
  return activity?.kind === "tool" && activity.iteration !== undefined
}

function activityGroup(
  activities: UserStoryAgentActivity[]
): UserStoryActivityNode {
  const first = activities[0]
  return {
    activities,
    children: activities.map(activityNode),
    id: `parallel-tools-${first?.iteration}-${first?.id}`,
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
