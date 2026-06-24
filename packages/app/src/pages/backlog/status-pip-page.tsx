import * as React from "react"

import { BacklogColumnHeader } from "@/components/backlog/board/backlog-column"
import { UserStoryCard } from "@/components/backlog/board/user-story-card"
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
import { usePlatform, type BacklogStatusPipSnapshot } from "@/context/platform"

const activeStatuses = new Set<BacklogColumnId>(["in-progress", "in-review"])
const pageTitle = "Active User Stories"
const initialSnapshot: BacklogStatusPipSnapshot = {
  authStatus: "loading",
  hasActiveProject: false,
  loading: true,
  stories: [],
}

export function BacklogStatusPipPage() {
  const platform = usePlatform()
  const [snapshot, setSnapshot] =
    React.useState<BacklogStatusPipSnapshot>(initialSnapshot)
  const activeStories = React.useMemo(
    () => snapshot.stories.filter(activeStory).sort(compareActiveStories),
    [snapshot.stories]
  )
  const headerColumn = React.useMemo(
    () => ({
      description: statusText(
        snapshot.authStatus,
        snapshot.hasActiveProject,
        activeStories.length
      ),
      id: headerColumnId(activeStories),
      title: "Active User Stories",
    }),
    [activeStories, snapshot.authStatus, snapshot.hasActiveProject]
  )

  React.useEffect(() => {
    document.title = pageTitle
  }, [])

  React.useEffect(() => {
    return platform.backlogStatusPip?.onSnapshot(setSnapshot)
  }, [platform.backlogStatusPip])

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-muted/30">
        <BacklogColumnHeader
          column={headerColumn}
          count={activeStories.length}
        />
        <ScrollArea className="min-h-0 flex-1 bg-foreground/5 dark:bg-background">
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
                {emptyText(
                  snapshot.authStatus,
                  snapshot.hasActiveProject,
                  snapshot.loading
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </section>
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

function compareActiveStories(left: UserStory, right: UserStory) {
  return activeStoryRank(left) - activeStoryRank(right)
}

function activeStoryRank(story: UserStory) {
  if (story.status === "in-review") return 0
  return 1
}

function headerColumnId(stories: UserStory[]): BacklogColumnId {
  if (stories.some((story) => story.status === "in-review")) return "in-review"
  if (stories.some((story) => story.status === "in-progress"))
    return "in-progress"
  return "ready"
}

function statusText(
  authStatus: BacklogStatusPipSnapshot["authStatus"],
  hasActiveProject: boolean,
  activeCount: number
) {
  if (authStatus === "loading") return "Loading session"
  if (authStatus === "unauthenticated") return "Sign in to sync backlog"
  if (!hasActiveProject) return "Open a project to track active stories"
  return `${activeCount} active ${activeCount === 1 ? "story" : "stories"}`
}

function emptyText(
  authStatus: BacklogStatusPipSnapshot["authStatus"],
  hasActiveProject: boolean,
  loading: boolean
) {
  if (authStatus === "loading" || loading) return "Loading user stories."
  if (authStatus === "unauthenticated") return "Sign in to view active stories."
  if (!hasActiveProject) return "Open a project to load user stories."
  return "No user story is currently in progress or in review."
}
