import type { UserStory } from "@/components/backlog/data/backlog-data"

const statusPipStoryStatuses = new Set(["in-progress", "in-review"])

export function backlogStatusPipStories(stories: UserStory[]): UserStory[] {
  return stories.filter(statusPipStory).map(statusPipStorySnapshot)
}

function statusPipStory(story: UserStory) {
  return statusPipStoryStatuses.has(story.status)
}

function statusPipStorySnapshot(story: UserStory): UserStory {
  return {
    agentStatus: story.agentStatus,
    createdAt: story.createdAt,
    id: story.id,
    owner: story.owner,
    priority: story.priority,
    projectId: story.projectId,
    status: story.status,
    storyNumber: story.storyNumber,
    summary: "",
    title: story.title,
  }
}
