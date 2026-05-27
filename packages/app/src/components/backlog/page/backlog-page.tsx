import * as React from "react"
import type { AgentEvent } from "@blame/agent-runtime"
import { toast } from "sonner"

import { backlogColumns } from "@/components/backlog/data/backlog-data"
import {
  agentEventText,
  agentFlowUpdate,
  completedAgentRun,
  shouldPersistAgentEvent,
} from "@/components/backlog/data/agent-flow"
import { useBacklogStore } from "@/components/backlog/data/backlog-store"
import type {
  BacklogAction,
  BacklogColumnId,
  UserStory,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import { useModelSelection } from "@/components/model/model-selector"
import type { DrawerTarget } from "@/components/backlog/shared/backlog-types"
import { BacklogColumn } from "@/components/backlog/board/backlog-column"
import { BacklogToolbar } from "@/components/backlog/board/backlog-toolbar"
import { UserStoryDrawer } from "@/components/backlog/drawer/user-story-drawer"
import { useBacklogRotation } from "@/components/backlog/page/use-backlog-rotation"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { useCloudAuth } from "@/context/cloud-auth"
import type { CloudProjectInitializationStatus } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

export function BacklogPage() {
  const backlog = useBacklogStore()
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  useBacklogRotation(backlog)
  const [drawerTarget, setDrawerTarget] = React.useState<DrawerTarget>()
  const initializationStatus = useProjectInitializationStatus()
  const queueInitializing = projectInitializing(initializationStatus)
  const storiesRef = React.useRef(backlog.stories)

  React.useEffect(() => {
    storiesRef.current = backlog.stories
  }, [backlog.stories])

  const drawerUserStory = React.useMemo(() => {
    if (!drawerTarget?.userStory) return undefined
    return (
      backlog.stories.find(
        (story) => story.id === drawerTarget.userStory?.id
      ) ?? drawerTarget.userStory
    )
  }, [backlog.stories, drawerTarget])
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
      const cleanup = await inactiveStoryCleanup(
        story,
        input,
        platform,
        projects.activeProject?.path
      )
      const nextStory = await backlog.update(story, { ...input, ...cleanup })
      setDrawerTarget((current) =>
        current?.userStory?.id === story.id
          ? { ...current, userStory: nextStory }
          : current
      )
      return nextStory
    },
    [backlog, platform, projects.activeProject?.path]
  )
  const runStoryAction = React.useCallback(
    async (story: UserStory, action: BacklogAction) => {
      if (action === "Send to Dev Agent") {
        return updateStory(story, { status: "ready" })
      }
      if (action === "Dequeue") return updateStory(story, { status: "backlog" })
      if (action === "Rework") {
        return updateStory(story, {
          discardedReason: null,
          status: "backlog",
        })
      }
    },
    [updateStory]
  )
  const rejectStory = React.useCallback(
    async (story: UserStory, choice: RejectChoice) => {
      if (choice === "request-changes") {
        return updateStory(story, {
          agentStatus: "Running",
          status: "in-progress",
        })
      }
      return updateStory(story, {
        discardedReason: "Rejected during review",
        status: "discarded",
      })
    },
    [updateStory]
  )
  const openWorktree = React.useCallback(
    async (story: UserStory) => {
      if (!story.worktree) {
        toast.error("Unable to open worktree", {
          description: "This user story has no worktree.",
          position: "bottom-right",
        })
        return
      }
      if (!platform.openPath) {
        toast.error("Unable to open worktree", {
          description: "Desktop shell integration is not available.",
          position: "bottom-right",
        })
        return
      }
      const error = await platform.openPath(story.worktree)
      if (error) {
        toast.error("Unable to open worktree", {
          description: error,
          position: "bottom-right",
        })
      }
    },
    [platform]
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
    [platform, updateStory]
  )
  const unpauseAgent = React.useCallback(
    async (story: UserStory) => {
      if (!story.worktree) {
        toast.error("Unable to resume agent", {
          description: "This user story has no active worktree.",
          position: "bottom-right",
        })
        return story
      }
      if (auth.status !== "authenticated" || !selection.currentModel) {
        toast.error("Unable to resume agent", {
          description: "Reconnect the provider and select a model.",
          position: "bottom-right",
        })
        return story
      }
      const session = await platform.agent?.sessions.startDevelopment({
        apiConnection: auth.apiConnection,
        providerId: selection.currentModel.provider.id,
        modelId: selection.currentModel.id,
        reasoningEffort: selection.currentVariant,
        title: story.title,
        summary: story.summary,
        cwd: story.worktree,
        workspaceRoot: story.worktree,
      })
      if (!session) {
        toast.error("Unable to resume agent", {
          description: "Desktop agent runtime is not available.",
          position: "bottom-right",
        })
        return story
      }
      const updatedStory = await updateStory(story, {
        agentLastError: null,
        agentLastEvent: `Cline debug log: ${clineLogPath(story.worktree, session.sessionId)}`,
        agentActivities: [],
        agentFinalResponse: null,
        agentModelId: selection.currentModel.id,
        agentProviderId: selection.currentModel.provider.id,
        agentStatus: "Running",
        clineSessionId: session.sessionId,
        status: "in-progress",
      })
      let authenticationFailed = false
      const unsubscribe = platform.agent.sessions.onEvent(
        session.sessionId,
        (event) => {
          if (authenticationFailed) return
          authenticationFailed = expiredAuthenticationToken(
            agentEventText(event)
          )
          const currentStory = activeStory(updatedStory, storiesRef.current)
          const update = agentEventUpdate(currentStory, event)
          if (shouldPersistAgentEvent(event, update)) {
            void updateStory(currentStory, update)
          }
          if (
            authenticationFailed ||
            event.type === "done" ||
            event.type === "error"
          )
            unsubscribe()
        }
      )
      void platform.agent.sessions.sendDevelopment({
        sessionId: session.sessionId,
        title: story.title,
        summary: story.summary,
      })
      return updatedStory
    },
    [
      auth,
      platform.agent,
      selection.currentModel,
      selection.currentVariant,
      updateStory,
    ]
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
              onAction={runStoryAction}
              onCreateUserStory={openCreateDrawer}
              onOpenDrawer={openDrawer}
              onOpenWorktree={openWorktree}
              onReject={rejectStory}
              onStopAgent={stopAgent}
              onUnpauseAgent={unpauseAgent}
              queueInitializing={column.id === "ready" && queueInitializing}
              storySetupInitializing={backlog.storySetupInitializing}
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
        userStory={drawerUserStory}
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
        onOpenDrawer={openDrawer}
        onReject={rejectStory}
        onStopAgent={stopAgent}
        setupInitializing={backlog.storySetupInitializing(drawerUserStory)}
      />
    </div>
  )
}

function useProjectInitializationStatus() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const [snapshot, setSnapshot] =
    React.useState<ProjectInitializationStatusSnapshot>()
  const activeProjectId = projects.activeProject?.id
  const status =
    auth.status === "authenticated" && snapshot?.projectId === activeProjectId
      ? snapshot.status
      : null

  React.useEffect(() => {
    if (!projects.activeProject || auth.status !== "authenticated") {
      return
    }
    let cancelled = false
    const cloud = createCloudApi(auth.apiConnection)
    const refresh = async () => {
      const snapshot = await cloud.projectInitialization(
        projects.activeProject.id
      )
      if (cancelled) return
      setSnapshot({
        projectId: projects.activeProject.id,
        status: snapshot.initialization?.status ?? "pending",
      })
    }
    void refresh().catch(() => {
      if (!cancelled) setSnapshot(undefined)
    })
    const timer = window.setInterval(() => {
      void refresh().catch(() => undefined)
    }, 5_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [auth, projects.activeProject])

  return status
}

type ProjectInitializationStatusSnapshot = {
  projectId: string
  status: CloudProjectInitializationStatus
}

function projectInitializing(status: CloudProjectInitializationStatus | null) {
  return status === "pending" || status === "running"
}

async function inactiveStoryCleanup(
  story: UserStory,
  input: UserStoryUpdate,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined
): Promise<UserStoryUpdate> {
  const nextStatus = input.status ?? story.status
  if (!leavesRuntimeStatus(story.status, nextStatus)) return {}
  await stopStoryRuntime(story, platform)
  await removeStoryWorktree(story, platform, repositoryRoot)
  return inactiveStoryFields()
}

const runtimeStatuses = new Set<BacklogColumnId>(["in-progress", "in-review"])

function leavesRuntimeStatus(
  currentStatus: BacklogColumnId,
  nextStatus: BacklogColumnId
) {
  return runtimeStatuses.has(currentStatus) && !runtimeStatuses.has(nextStatus)
}

async function stopStoryRuntime(
  story: UserStory,
  platform: ReturnType<typeof usePlatform>
) {
  await Promise.all([
    story.clineSessionId
      ? platform.agent?.sessions
          .abort(story.clineSessionId)
          .catch(() => undefined)
      : Promise.resolve(),
    story.worktree
      ? platform.workspace
          ?.stopProjectSetup({ worktree: story.worktree })
          .catch(() => false)
      : Promise.resolve(),
  ])
}

async function removeStoryWorktree(
  story: UserStory,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined
) {
  if (!story.worktree) return
  if (!repositoryRoot) throw new Error("Unable to resolve repository root.")
  const removed = await platform.workspace?.removeWorktree({
    repositoryRoot,
    worktree: story.worktree,
  })
  if (!removed) throw new Error("Unable to remove worktree.")
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

function activeStory(story: UserStory, stories: UserStory[]) {
  return stories.find((currentStory) => currentStory.id === story.id) ?? story
}

function clineLogPath(worktree: string, sessionId: string) {
  return `${worktree}/.blame/logs/cline-${sessionId}.log`
}

function agentEventUpdate(
  story: UserStory,
  event: AgentEvent
): UserStoryUpdate {
  const text = agentEventText(event)
  const flowUpdate = agentFlowUpdate(story, event)
  if (expiredAuthenticationToken(text)) {
    toast.error("Agent authentication expired", {
      description: `${text} Reconnect the selected provider, then restart the story.`,
      position: "bottom-right",
    })
    return {
      ...flowUpdate,
      agentLastError: text,
      agentLastEvent: text,
      agentStatus: "Paused",
    }
  }
  if (completedAgentRun(event)) {
    return {
      ...flowUpdate,
      agentLastError: null,
      agentLastEvent: text || "Agent completed. Ready for review.",
      agentStatus: null,
      status: "in-review",
    }
  }
  return {
    ...flowUpdate,
    agentLastError:
      event.type === "error" ? text || "Agent session failed" : undefined,
    agentLastEvent: text || event.type,
  }
}

function expiredAuthenticationToken(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes("authentication token") &&
    normalized.includes("invalidated")
  )
}
