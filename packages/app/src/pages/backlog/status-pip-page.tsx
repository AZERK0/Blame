import * as React from "react"

import { UserStoryCard } from "@/components/backlog/board/user-story-card"
import { useBacklogStore } from "@/components/backlog/data/backlog-store"
import type {
  BacklogAction,
  BacklogColumnId,
  UserStory,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import type { DrawerTarget } from "@/components/backlog/shared/backlog-types"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"

const activeStatuses = new Set<BacklogColumnId>(["in-progress", "in-review"])
const pageTitle = "Active User Stories"
const refreshDelayMs = 2_500

export function BacklogStatusPipPage() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const backlog = useBacklogStore()
  const loadBacklog = backlog.load
  const activeStories = React.useMemo(
    () => backlog.stories.filter(activeStory),
    [backlog.stories]
  )

  React.useEffect(() => {
    document.title = pageTitle
  }, [])

  React.useEffect(() => {
    if (auth.status !== "authenticated" || !projects.activeProject) return
    void loadBacklog()
    const timer = window.setInterval(() => void loadBacklog(), refreshDelayMs)
    return () => window.clearInterval(timer)
  }, [auth.status, loadBacklog, projects.activeProject])

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header className="border-b px-4 py-3">
        <h1 className="truncate text-sm font-semibold">Active User Stories</h1>
        <p className="truncate text-xs text-muted-foreground">
          {statusText(
            auth.status,
            projects.activeProject,
            activeStories.length
          )}
        </p>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-3">
          {activeStories.map((story) => (
            <UserStoryCard
              key={story.id}
              onAction={(story, action) =>
                requestStoryAction(platform, story, action)
              }
              onDeleteUserStory={(story) =>
                requestStoryAction(platform, story, "Delete Permanently")
              }
              onOpenDrawer={(target) => requestStoryDrawer(platform, target)}
              onOpenWorktree={(story) =>
                requestStoryAction(platform, story, "Open Worktree")
              }
              onReject={(story, choice) =>
                requestRejectChoice(platform, story, choice)
              }
              onStopAgent={(story, choice) =>
                requestStopChoice(platform, story, choice)
              }
              onUnpauseAgent={(story) =>
                requestStoryAction(platform, story, "Unpause Agent").then(
                  () => story
                )
              }
              story={story}
            />
          ))}
          {!activeStories.length && (
            <div className="rounded-lg border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
              {emptyText(auth.status, projects.activeProject, backlog.loading)}
            </div>
          )}
        </div>
      </ScrollArea>
    </main>
  )
}

function requestStoryAction(
  platform: ReturnType<typeof usePlatform>,
  story: UserStory,
  action: BacklogAction
) {
  return (
    platform.backlogStatusPip?.request({ action, storyId: story.id }) ??
    Promise.resolve(false)
  )
}

function requestStoryDrawer(
  platform: ReturnType<typeof usePlatform>,
  target: DrawerTarget
) {
  if (!target.userStory) return
  void platform.backlogStatusPip?.request({
    drawer: {
      focusComment: target.focusComment,
      initialDevelopmentTab: target.initialDevelopmentTab,
      initialTab: target.initialTab,
    },
    storyId: target.userStory.id,
  })
}

async function requestRejectChoice(
  platform: ReturnType<typeof usePlatform>,
  story: UserStory,
  choice: RejectChoice
) {
  await platform.backlogStatusPip?.request({
    rejectChoice: choice,
    storyId: story.id,
  })
  return story
}

async function requestStopChoice(
  platform: ReturnType<typeof usePlatform>,
  story: UserStory,
  choice: StopAgentChoice
) {
  await platform.backlogStatusPip?.request({
    stopChoice: choice,
    storyId: story.id,
  })
  return story
}

function activeStory(story: UserStory) {
  return activeStatuses.has(story.status)
}

function statusText(
  authStatus: ReturnType<typeof useCloudAuth>["status"],
  activeProject: ReturnType<typeof useProjects>["activeProject"],
  activeCount: number
) {
  if (authStatus === "loading") return "Loading session"
  if (authStatus === "unauthenticated") return "Sign in to sync backlog"
  if (!activeProject) return "Open a project to track active stories"
  return `${activeCount} active ${activeCount === 1 ? "story" : "stories"}`
}

function emptyText(
  authStatus: ReturnType<typeof useCloudAuth>["status"],
  activeProject: ReturnType<typeof useProjects>["activeProject"],
  loading: boolean
) {
  if (authStatus === "loading" || loading) return "Loading user stories."
  if (authStatus === "unauthenticated") return "Sign in to view active stories."
  if (!activeProject) return "Open a project to load user stories."
  return "No user story is currently in progress or in review."
}
