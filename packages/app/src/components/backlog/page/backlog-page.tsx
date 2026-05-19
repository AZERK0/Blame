import * as React from "react"

import { backlogColumns } from "@/components/backlog/data/backlog-data"
import { useBacklogStore } from "@/components/backlog/data/backlog-store"
import type { UserStory, UserStoryUpdate } from "@/components/backlog/data/backlog-data"
import type { StopAgentChoice } from "@/components/backlog/actions/story-action-dialogs"
import type { DrawerTarget } from "@/components/backlog/shared/backlog-types"
import { BacklogColumn } from "@/components/backlog/board/backlog-column"
import { BacklogToolbar } from "@/components/backlog/board/backlog-toolbar"
import { UserStoryDrawer } from "@/components/backlog/drawer/user-story-drawer"
import { useBacklogRotation } from "@/components/backlog/page/use-backlog-rotation"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"

export function BacklogPage() {
  const backlog = useBacklogStore()
  const platform = usePlatform()
  const projects = useProjects()
  useBacklogRotation(backlog)
  const [drawerTarget, setDrawerTarget] = React.useState<DrawerTarget>()
  const openDrawer = React.useCallback((target: DrawerTarget) => {
    setDrawerTarget(target)
  }, [])
  const openCreateDrawer = React.useCallback(() => {
    if (!backlog.projectPath) return
    setDrawerTarget({
      mode: "create",
      initialTab: "user-story",
    })
  }, [backlog.projectPath])
  const updateStory = React.useCallback(
    async (story: UserStory, input: UserStoryUpdate) => {
      const cleanup = await inactiveStoryCleanup(story, input, platform)
      const nextStory = await backlog.update(story, { ...input, ...cleanup })
      setDrawerTarget((current) =>
        current?.userStory?.id === story.id
          ? { ...current, userStory: nextStory }
          : current
      )
      return nextStory
    },
    [backlog, platform]
  )
  const stopAgent = React.useCallback(
    async (story: UserStory, choice: StopAgentChoice) => {
      if (choice === "pause-feedback") {
        await stopStoryRuntime(story, platform)
        return updateStory(story, {
          agentLastError: null,
          agentLastEvent: "Agent paused by user.",
          agentStatus: "Paused",
          previewUrl: null,
          status: "in-review",
        })
      }
      if (choice === "discard-worktree") {
        await stopStoryRuntime(story, platform)
        await removeStoryWorktree(story, platform, projects.activeProject?.path)
        return updateStory(story, {
          discardedReason: "Worktree discarded by user",
          status: "discarded",
        })
      }
      return updateStory(story, {
        discardedReason: null,
        status: "backlog",
      })
    },
    [platform, projects.activeProject?.path, updateStory]
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 lg:p-6">
      <BacklogToolbar
        disabled={!backlog.projectPath}
        onCreateUserStory={openCreateDrawer}
        storyCount={backlog.stories.length}
      />
      {backlog.error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {backlog.error}
        </div>
      )}
      {!backlog.projectPath && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Open a project to load user stories.
        </div>
      )}
      {backlog.loading && (
        <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          Loading user stories.
        </div>
      )}
      <ScrollArea className="min-h-0 min-w-0 flex-1">
        <div className="grid min-w-500 grid-cols-6 gap-3 pb-3">
          {backlogColumns.map((column) => (
            <BacklogColumn
              key={column.id}
              column={column}
              onCreateUserStory={openCreateDrawer}
              onOpenDrawer={openDrawer}
              onStopAgent={stopAgent}
              stories={backlog.storiesForColumn(column.id)}
            />
          ))}
        </div>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
      <UserStoryDrawer
        open={Boolean(drawerTarget)}
        onOpenChange={(open) => {
          if (!open) setDrawerTarget(undefined)
        }}
        userStory={drawerTarget?.userStory}
        mode={drawerTarget?.mode ?? "view"}
        initialTab={drawerTarget?.initialTab}
        initialDevelopmentTab={drawerTarget?.initialDevelopmentTab}
        focusComment={drawerTarget?.focusComment}
        onCreateUserStory={async (input) => {
          const story = await backlog.create(input)
          setDrawerTarget({ userStory: story, mode: "edit" })
          return story
        }}
        onUpdateUserStory={async (story, input) => {
          return updateStory(story, input)
        }}
      />
    </div>
  )
}

async function inactiveStoryCleanup(
  story: UserStory,
  input: UserStoryUpdate,
  platform: ReturnType<typeof usePlatform>
): Promise<UserStoryUpdate> {
  const nextStatus = input.status ?? story.status
  if (nextStatus === "in-progress" || nextStatus === "in-review") return {}
  await stopStoryRuntime(story, platform)
  return inactiveStoryFields()
}

async function stopStoryRuntime(
  story: UserStory,
  platform: ReturnType<typeof usePlatform>
) {
  await Promise.all([
    story.clineSessionId
      ? platform.agent?.sessions.abort(story.clineSessionId).catch(() => undefined)
      : Promise.resolve(),
    story.worktree
      ? platform.workspace?.stopProjectSetup({ worktree: story.worktree }).catch(() => false)
      : Promise.resolve(),
  ])
}

async function removeStoryWorktree(
  story: UserStory,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined
) {
  if (!story.worktree || !repositoryRoot) return
  await platform.workspace?.removeWorktree({
    repositoryRoot,
    worktree: story.worktree,
  }).catch(() => false)
}

function inactiveStoryFields(): UserStoryUpdate {
  return {
    agentModelId: null,
    agentProviderId: null,
    agentStatus: null,
    branch: null,
    clineSessionId: null,
    previewUrl: null,
    worktree: null,
  }
}
