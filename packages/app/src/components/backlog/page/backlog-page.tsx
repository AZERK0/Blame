import * as React from "react"
import type { AgentEvent } from "@blame/agent-runtime"
import { toast } from "sonner"

import { backlogColumns } from "@/components/backlog/data/backlog-data"
import { useBacklogStore } from "@/components/backlog/data/backlog-store"
import type { UserStory, UserStoryUpdate } from "@/components/backlog/data/backlog-data"
import type { StopAgentChoice } from "@/components/backlog/actions/story-action-dialogs"
import { useModelSelection } from "@/components/model/model-selector"
import type { DrawerTarget } from "@/components/backlog/shared/backlog-types"
import { BacklogColumn } from "@/components/backlog/board/backlog-column"
import { BacklogToolbar } from "@/components/backlog/board/backlog-toolbar"
import { UserStoryDrawer } from "@/components/backlog/drawer/user-story-drawer"
import { useBacklogRotation } from "@/components/backlog/page/use-backlog-rotation"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"

export function BacklogPage() {
  const backlog = useBacklogStore()
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  useBacklogRotation(backlog)
  const [drawerTarget, setDrawerTarget] = React.useState<DrawerTarget>()
  const drawerUserStory = React.useMemo(() => {
    if (!drawerTarget?.userStory) return undefined
    return (
      backlog.stories.find((story) => story.id === drawerTarget.userStory?.id) ??
      drawerTarget.userStory
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
      const prompt = storyPrompt(story)
      const session = await platform.agent?.sessions.start({
        apiConnection: auth.apiConnection,
        providerId: selection.currentModel.provider.id,
        modelId: selection.currentModel.id,
        reasoningEffort: selection.currentVariant,
        autoApproveWriteTools: true,
        autoSendPrompt: false,
        mode: "act",
        maxIterations: 32,
        prompt,
        cwd: story.worktree,
        workspaceRoot: story.worktree,
        systemPrompt: developmentSystemPrompt(),
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
        agentModelId: selection.currentModel.id,
        agentProviderId: selection.currentModel.provider.id,
        agentStatus: "Running",
        clineSessionId: session.sessionId,
        status: "in-progress",
      })
      let authenticationFailed = false
      const unsubscribe = platform.agent.sessions.onEvent(session.sessionId, (event) => {
        if (authenticationFailed) return
        authenticationFailed = expiredAuthenticationToken(agentEventText(event))
        void updateStory(updatedStory, agentEventUpdate(event))
        if (authenticationFailed || event.type === "done" || event.type === "error") unsubscribe()
      })
      void platform.agent.sessions.send({ sessionId: session.sessionId, prompt })
      return updatedStory
    },
    [auth, platform.agent, selection.currentModel, selection.currentVariant, updateStory]
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
              onUnpauseAgent={unpauseAgent}
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

function storyPrompt(story: UserStory) {
  return [
    `Implement this user story: ${story.title}`,
    "",
    story.summary,
    "",
    "Work directly in the current worktree.",
    "Make the required code changes, then stop when the implementation is complete.",
  ].join("\n")
}

function developmentSystemPrompt() {
  return [
    "You are Blame, an autonomous coding agent running inside a dedicated git worktree.",
    "You must inspect the repository, edit files as needed, and implement the user story.",
    "Do not wait for extra confirmation before using available write tools.",
  ].join(" ")
}

function clineLogPath(worktree: string, sessionId: string) {
  return `${worktree}/.blame/logs/cline-${sessionId}.log`
}

function agentEventUpdate(event: AgentEvent): UserStoryUpdate {
  const text = agentEventText(event)
  if (expiredAuthenticationToken(text)) {
    toast.error("Agent authentication expired", {
      description: `${text} Reconnect the selected provider, then restart the story.`,
      position: "bottom-right",
    })
    return {
      agentLastError: text,
      agentLastEvent: text,
      agentStatus: "Paused",
    }
  }
  if (completedAgentRun(event)) {
    return {
      agentLastError: null,
      agentLastEvent: text || "Agent completed. Ready for review.",
      agentStatus: null,
      status: "in-review",
    }
  }
  return {
    agentLastError: event.type === "error" ? text || "Agent session failed" : undefined,
    agentLastEvent: text || event.type,
  }
}

function agentEventText(event: AgentEvent) {
  if (!event.payload || typeof event.payload !== "object") return ""
  if ("text" in event.payload && typeof event.payload.text === "string") {
    return event.payload.text
  }
  if ("message" in event.payload && typeof event.payload.message === "string") {
    return event.payload.message
  }
  if ("error" in event.payload && typeof event.payload.error === "string") {
    return event.payload.error
  }
  return ""
}

function expiredAuthenticationToken(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes("authentication token") &&
    normalized.includes("invalidated")
  )
}

function completedAgentRun(event: AgentEvent) {
  if (event.type !== "done") return false
  if (!event.payload || typeof event.payload !== "object") return true
  if ("reason" in event.payload && typeof event.payload.reason === "string") {
    return !failedDoneReason(event.payload.reason)
  }
  return true
}

function failedDoneReason(reason: string) {
  return ["error", "aborted", "cancelled"].includes(reason)
}
