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
import { subscribeAgentEvents } from "@/components/backlog/data/agent-event-stream"
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
import { useBacklogRotation } from "@/pages/backlog/use-backlog-rotation"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { useCloudAuth } from "@/context/cloud-auth"
import type { CloudProjectInitializationStatus } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

const agentEventPersistDelayMs = 1_500

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
  const pendingAgentUpdates = React.useRef(new Map<number, PendingAgentUpdate>())

  React.useEffect(() => {
    storiesRef.current = backlog.stories
  }, [backlog.stories])

  React.useEffect(
    () => () => clearPendingAgentUpdates(pendingAgentUpdates.current),
    []
  )

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
    async (
      story: UserStory,
      input: UserStoryUpdate,
      options: { cleanup?: boolean } = {}
    ) => {
      const cleanup =
        options.cleanup === false
          ? {}
          : await inactiveStoryCleanup(
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
  const updateStoryLocal = React.useCallback(
    (story: UserStory, input: UserStoryUpdate) => {
      const currentStory = activeStory(story, storiesRef.current)
      const nextStory = { ...currentStory, ...definedUpdate(input) }
      storiesRef.current = storiesRef.current.map((current) =>
        current.id === story.id ? nextStory : current
      )
      backlog.updateLocal(currentStory, input)
      setDrawerTarget((current) =>
        current?.userStory?.id === story.id
          ? { ...current, userStory: nextStory }
          : current
      )
      return nextStory
    },
    [backlog]
  )
  const queueAgentUpdate = React.useCallback(
    (story: UserStory, input: UserStoryUpdate) => {
      const pending = pendingAgentUpdates.current.get(story.id)
      if (pending) window.clearTimeout(pending.timer)
      const update = { ...pending?.input, ...input }
      const timer = window.setTimeout(() => {
        pendingAgentUpdates.current.delete(story.id)
        void updateStory(activeStory(story, storiesRef.current), update, {
          cleanup: false,
        }).catch(() => undefined)
      }, agentEventPersistDelayMs)
      pendingAgentUpdates.current.set(story.id, { input: update, timer })
    },
    [updateStory]
  )
  const flushAgentUpdate = React.useCallback(
    (story: UserStory, input: UserStoryUpdate) => {
      const pending = pendingAgentUpdates.current.get(story.id)
      if (pending) window.clearTimeout(pending.timer)
      pendingAgentUpdates.current.delete(story.id)
      return updateStory(
        activeStory(story, storiesRef.current),
        { ...pending?.input, ...input },
        { cleanup: false }
      )
    },
    [updateStory]
  )
  const persistAgentUpdate = React.useCallback(
    (story: UserStory, input: UserStoryUpdate, immediate: boolean) => {
      const nextStory = updateStoryLocal(story, input)
      if (immediate) {
        void flushAgentUpdate(nextStory, input).catch(() => undefined)
        return
      }
      queueAgentUpdate(nextStory, input)
    },
    [flushAgentUpdate, queueAgentUpdate, updateStoryLocal]
  )
  const persistAgentEvent = React.useCallback(
    (story: UserStory, event: AgentEvent) => {
      const currentStory = activeStory(story, storiesRef.current)
      const update = agentEventUpdate(currentStory, event)
      if (!shouldPersistAgentEvent(event, update)) return
      persistAgentUpdate(currentStory, update, immediateAgentEvent(event))
    },
    [persistAgentUpdate]
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
      const agent = platform.agent
      if (!agent) {
        toast.error("Unable to resume agent", {
          description: "Desktop agent runtime is not available.",
          position: "bottom-right",
        })
        return story
      }
      const codePractices = await projectCodePractices(auth, projects)
      const session = await agent.sessions.startDevelopment({
        apiConnection: auth.apiConnection,
        providerId: selection.currentModel.provider.id,
        modelId: selection.currentModel.id,
        reasoningEffort: selection.currentVariant,
        title: story.title,
        summary: story.summary,
        cwd: story.worktree,
        workspaceRoot: story.worktree,
        codePractices,
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
      const unsubscribe = subscribeAgentEvents(
        platform,
        session.sessionId,
        (event) => {
          if (authenticationFailed) return
          authenticationFailed = expiredAuthenticationToken(
            agentEventText(event)
          )
          persistAgentEvent(updatedStory, event)
          if (
            authenticationFailed ||
            event.type === "done" ||
            event.type === "error"
          )
            unsubscribe()
        }
      )
      void agent.sessions.sendDevelopment({
        sessionId: session.sessionId,
        title: story.title,
        summary: story.summary,
      })
      return updatedStory
    },
    [
      auth,
      platform,
      projects,
      selection.currentModel,
      selection.currentVariant,
      updateStory,
      persistAgentEvent,
    ]
  )

  const approveAndMergeStory = React.useCallback(
    async (story: UserStory) => {
      const validationError = approveAndMergeValidationError(
        story,
        auth,
        platform,
        projects.activeProject?.path,
        selection.currentModel
      )
      if (validationError) {
        toast.error("Unable to approve and merge", {
          description: validationError,
          position: "bottom-right",
        })
        return story
      }
      const runningStory = await updateStory(story, {
        agentLastError: null,
        agentLastEvent: "Approve & Merge started.",
        agentStatus: "Running",
      })
      try {
        const codePractices = await projectCodePractices(auth, projects)
        const result = await platform.agent!.approveAndMerge({
          apiConnection: auth.apiConnection,
          providerId: selection.currentModel!.provider.id,
          modelId: selection.currentModel!.id,
          reasoningEffort: selection.currentVariant,
          repositoryRoot: projects.activeProject!.path,
          worktree: story.worktree!,
          storyBranch: story.branch!,
          title: story.title,
          summary: story.summary,
          codePractices,
        })
        toast.success("Story approved and merged", {
          description: `Merged into ${result.targetBranch}.`,
          position: "bottom-right",
        })
        const mergedStory = await updateStory(
          runningStory,
          {
            ...inactiveStoryFields(),
            agentLastError: null,
            agentLastEvent: `Merged into ${result.targetBranch}.`,
            mergeCommit: result.mergeCommit,
            mergedAt: new Date().toISOString(),
            status: "done",
          },
          { cleanup: false }
        )
        void cleanupMergedStory(
          runningStory,
          platform,
          projects.activeProject?.path
        )
        return mergedStory
      } catch (error) {
        const message = errorMessage(error)
        toast.error("Approve & Merge failed", {
          description: message,
          position: "bottom-right",
        })
        return updateStory(runningStory, {
          agentLastError: message,
          agentLastEvent: message,
          agentStatus: null,
        })
      }
    },
    [
      auth,
      platform,
      projects,
      selection.currentModel,
      selection.currentVariant,
      updateStory,
    ]
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
      if (action === "Approve & Merge") return approveAndMergeStory(story)
    },
    [approveAndMergeStory, updateStory]
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
        onApproveAndMerge={approveAndMergeStory}
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
      ? (snapshot?.status ?? null)
      : null

  React.useEffect(() => {
    const activeProject = projects.activeProject
    if (!activeProject || auth.status !== "authenticated") {
      return
    }
    let cancelled = false
    let timer: number | undefined
    const cloud = createCloudApi(auth.apiConnection)
    const refresh = async () => {
      const snapshot = await cloud.projectInitialization(
        activeProject.id
      )
      if (cancelled) return
      const status = snapshot.initialization?.status ?? "pending"
      setSnapshot({
        projectId: activeProject.id,
        status,
      })
      if (projectInitializing(status)) {
        timer = window.setTimeout(() => {
          void refresh().catch(() => undefined)
        }, 5_000)
      }
    }
    void refresh().catch(() => {
      if (!cancelled) setSnapshot(undefined)
    })
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
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

function approveAndMergeValidationError(
  story: UserStory,
  auth: ReturnType<typeof useCloudAuth>,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined,
  model: unknown
) {
  if (!story.worktree) return "This user story has no active worktree."
  if (!story.branch) return "This user story has no feature branch."
  if (!repositoryRoot) return "Unable to resolve the active project."
  if (auth.status !== "authenticated")
    return "Reconnect the provider before approving the merge."
  if (!model) return "Select a model before approving the merge."
  if (!platform.agent?.approveAndMerge)
    return "Desktop agent runtime is not available."
}

function projectCodePractices(
  auth: ReturnType<typeof useCloudAuth>,
  projects: ReturnType<typeof useProjects>
) {
  if (!projects.activeProject) return Promise.resolve([])
  return createCloudApi(auth.apiConnection)
    .projectInitialization(projects.activeProject.id)
    .then((snapshot) => snapshot.practices)
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

async function cleanupMergedStory(
  story: UserStory,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined
) {
  try {
    await stopStoryRuntime(story, platform)
    await removeStoryWorktree(story, platform, repositoryRoot)
  } catch (error) {
    toast.error("Merged story cleanup failed", {
      description: errorMessage(error),
      position: "bottom-right",
    })
  }
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

type PendingAgentUpdate = {
  input: UserStoryUpdate
  timer: number
}

function clearPendingAgentUpdates(updates: Map<number, PendingAgentUpdate>) {
  updates.forEach((update) => window.clearTimeout(update.timer))
  updates.clear()
}

function definedUpdate(input: UserStoryUpdate) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

function immediateAgentEvent(event: AgentEvent) {
  return (
    completedAgentRun(event) ||
    event.type === "error" ||
    expiredAuthenticationToken(agentEventText(event))
  )
}

function clineLogPath(worktree: string, sessionId: string) {
  return `${worktree}/.blame/logs/cline-${sessionId}.log`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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
