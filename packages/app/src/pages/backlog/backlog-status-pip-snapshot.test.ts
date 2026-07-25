import assert from "node:assert/strict"
import test from "node:test"

import type { UserStory } from "../../components/backlog/data/backlog-data.ts"
import { backlogStatusPipStories } from "./backlog-status-pip-snapshot.ts"

test("publishes only lightweight active story cards", () => {
  const active = story({
    agentActivities: [
      {
        createdAt: "2026-01-01T00:00:00.000Z",
        detail: "large detail",
        id: "activity-1",
        kind: "tool",
        title: "Tool",
      },
    ],
    agentFinalResponse: "large response",
    agentStatus: "Running",
    status: "in-progress",
  })
  const stories = backlogStatusPipStories([
    active,
    story({ id: "backlog-story", status: "backlog" }),
  ])

  assert.equal(stories.length, 1)
  assert.equal(stories[0]?.id, active.id)
  assert.equal(stories[0]?.agentStatus, "Running")
  assert.equal("agentActivities" in stories[0], false)
  assert.equal("agentFinalResponse" in stories[0], false)
})

function story(input: Partial<UserStory> = {}): UserStory {
  return {
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "story-1",
    owner: "Product",
    priority: "Medium",
    projectId: "project-1",
    status: "in-review",
    storyNumber: 1,
    summary: "Summary",
    title: "Title",
    ...input,
  }
}
