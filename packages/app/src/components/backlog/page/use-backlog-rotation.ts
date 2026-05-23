import * as React from "react"
import { toast } from "sonner"
import type { AgentEvent } from "@blame/agent-runtime"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import type { useBacklogStore } from "@/components/backlog/data/backlog-store"
import { useModelSelection } from "@/components/model/model-selector"
import { useCloudAuth } from "@/context/cloud-auth"
import type { ProjectSetupEvent } from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

const maxConcurrentDevelopmentStories = 3
const blockerRetryDelay = 30_000
const setupToastId = "backlog-rotation-setup"
const authToastId = "backlog-agent-auth"
const urlPattern = /\bhttps?:\/\/[^\s"'<>]+|\blocalhost:\d+[^\s"'<>]*/i

export function useBacklogRotation(backlog: ReturnType<typeof useBacklogStore>) {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  const startingStoryIds = React.useRef(new Set<number>())
  const blockedStories = React.useRef(new Map<number, number>())
  const reportedBlockers = React.useRef(new Set<string>())
  const reportedAgentErrors = React.useRef(new Set<string>())
  const agentAuthenticationBlockedUntil = React.useRef(0)
  const previewRecoveryKeys = React.useRef(new Set<string>())
  const [, refreshStartingStories] = React.useState(0)

  React.useEffect(() => {
    blockedStories.current.clear()
    reportedBlockers.current.clear()
    reportedAgentErrors.current.clear()
    agentAuthenticationBlockedUntil.current = 0
    previewRecoveryKeys.current.clear()
  }, [projects.activeProject?.id, selection.currentModel?.id])

  React.useEffect(() => {
    if (!projects.activeProject || auth.status !== "authenticated") return
    if (backlog.loading || !backlog.projectId) return
    if (agentAuthenticationBlockedUntil.current > Date.now()) return

    const readyStories = queuedStories(
      backlog.stories,
      startingStoryIds.current,
      blockedStories.current
    )
    if (readyStories.length === 0) return

    const availableSlots =
      maxConcurrentDevelopmentStories -
      runningStories(backlog.stories) -
      startingStoryIds.current.size
    if (availableSlots <= 0) return

    const storiesToStart = readyStories.slice(0, availableSlots)
    storiesToStart.forEach((story) => {
      startingStoryIds.current.add(story.id)
      void startStory(story)
        .catch((error) => reportBlocker(story, errorMessage(error)))
        .finally(() => {
          startingStoryIds.current.delete(story.id)
          refreshStartingStories((value) => value + 1)
        })
    })
    refreshStartingStories((value) => value + 1)
  }, [
    auth,
    backlog,
    platform,
    projects.activeProject,
    selection.currentModel,
    selection.currentVariant,
  ])

  async function startStory(story: UserStory) {
    if (!projects.activeProject) return
    const blocker = rotationBlocker(auth.status, platform, selection.currentModel)
    if (blocker) return reportBlocker(story, blocker)

    const initialization = await createCloudApi(auth.apiConnection)
      .projectInitialization(projects.activeProject.id)
      .then((snapshot) => snapshot.initialization)

    if (
      initialization?.status !== "done" ||
      !initialization.setupScript ||
      !initialization.dockerCompose
    ) {
      reportBlocker(
        story,
        "Project initialization is required before starting queued user stories."
      )
      return
    }

    const worktree = await platform.workspace.createWorktree({
      repositoryRoot: projects.activeProject.path,
      storyId: story.id,
      title: story.title,
    })
    const setup = await platform.workspace.runProjectSetup({
      worktree: worktree.worktree,
      setupScript: initialization.setupScript,
      dockerCompose: initialization.dockerCompose,
    })
    const unsubscribeSetup = platform.workspace.onSetupEvent(setup.runId, (event) => {
      void persistSetupEvent(story, event, worktree.worktree)
      if (event.type === "exit") unsubscribeSetup()
    })
    const session = await platform.agent.sessions.start({
      apiConnection: auth.apiConnection,
      providerId: selection.currentModel.provider.id,
      modelId: selection.currentModel.id,
      reasoningEffort: selection.currentVariant,
      autoApproveWriteTools: true,
      autoSendPrompt: false,
      mode: "act",
      maxIterations: 32,
      prompt: storyPrompt(story),
      cwd: worktree.worktree,
      workspaceRoot: worktree.worktree,
      systemPrompt: developmentSystemPrompt(),
    })
    const unsubscribeSession = platform.agent.sessions.onEvent(
      session.sessionId,
      (event) => {
        void persistAgentEvent(story, event)
        if (event.type === "done" || event.type === "error") unsubscribeSession()
      }
    )

    await backlog.update(story, {
      agentModelId: selection.currentModel.id,
      agentProviderId: selection.currentModel.provider.id,
      agentStatus: "Running",
      agentLastEvent: "Agent session started.",
      branch: worktree.branch,
      clineSessionId: session.sessionId,
      status: "in-progress",
      worktree: worktree.worktree,
    })
    void platform.agent.sessions.send({
      sessionId: session.sessionId,
      prompt: storyPrompt(story),
    })
  }

  function reportBlocker(story: UserStory, message: string) {
    const key = `${story.id}:${message}`
    blockedStories.current.set(story.id, Date.now() + blockerRetryDelay)
    window.setTimeout(() => {
      blockedStories.current.delete(story.id)
      refreshStartingStories((value) => value + 1)
    }, blockerRetryDelay)
    if (reportedBlockers.current.has(key)) return
    reportedBlockers.current.add(key)
    toast.error("User story stayed in Agent Queue", {
      description: message,
      id: `${setupToastId}-${story.id}`,
      position: "bottom-right",
    })
  }

  async function persistSetupEvent(
    story: UserStory,
    event: ProjectSetupEvent,
    worktree: string
  ) {
    const text = eventText(event)
    const previewUrl = setupCompleted(event)
      ? (await projectPreviewUrl(worktree)) ?? undefined
      : firstPreviewUrl(text)
    await backlog.update(story, {
      agentLastError: setupError(event) ? text : undefined,
      agentLastEvent: text,
      previewUrl,
    })
  }

  async function projectPreviewUrl(worktree: string) {
    return platform.workspace?.resolveProjectPreviewUrl?.({ worktree })
  }

  React.useEffect(() => {
    if (!platform.workspace?.resolveProjectPreviewUrl || backlog.loading) return
    backlog.stories
      .filter((story) => missingPreview(story))
      .forEach((story) => {
        if (!story.worktree) return
        const key = `${story.id}:${story.worktree}`
        if (previewRecoveryKeys.current.has(key)) return
        previewRecoveryKeys.current.add(key)
        void platform.workspace
          .resolveProjectPreviewUrl({ worktree: story.worktree })
          .then((previewUrl) => {
            if (previewUrl) return backlog.update(story, { previewUrl })
            return undefined
          })
          .catch(() => undefined)
      })
  }, [backlog, backlog.loading, backlog.stories, platform.workspace])

  async function persistAgentEvent(story: UserStory, event: AgentEvent) {
    const text = agentEventText(event)
    if (reportedAgentErrors.current.has(agentAuthenticationErrorKey(story))) return
    if (expiredAuthenticationToken(text)) {
      reportExpiredAuthenticationToken(story, text)
      await backlog.update(story, {
        agentLastError: text,
        agentLastEvent: text,
        agentStatus: "Paused",
      })
      return
    }
    if (completedAgentRun(event)) {
      await backlog.update(story, {
        agentLastError: null,
        agentLastEvent: text || "Agent completed. Ready for review.",
        agentStatus: null,
        status: "in-review",
      })
      return
    }
    await backlog.update(story, {
      agentLastError: event.type === "error" ? text || "Agent session failed" : undefined,
      agentLastEvent: text || event.type,
    })
  }

  function reportExpiredAuthenticationToken(story: UserStory, message: string) {
    const key = agentAuthenticationErrorKey(story)
    if (reportedAgentErrors.current.has(key)) return
    agentAuthenticationBlockedUntil.current = Date.now() + blockerRetryDelay
    window.setTimeout(() => refreshStartingStories((value) => value + 1), blockerRetryDelay)
    reportedAgentErrors.current.add(key)
    toast.error("Agent authentication expired", {
      description: `${message} Reconnect the selected provider, then restart the story.`,
      id: `${authToastId}-${story.id}`,
      position: "bottom-right",
    })
  }
}

function runningStories(stories: UserStory[]) {
  return stories.filter(
    (story) => story.status === "in-progress" && story.agentStatus !== "Paused"
  ).length
}

function queuedStories(
  stories: UserStory[],
  startingStoryIds: Set<number>,
  blockedStories: Map<number, number>
) {
  const now = Date.now()
  return stories
    .filter(
      (story) =>
        story.status === "ready" &&
        !startingStoryIds.has(story.id) &&
        !blocked(story.id, blockedStories, now)
    )
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    )
}

function blocked(storyId: number, blockedStories: Map<number, number>, now: number) {
  const retryAt = blockedStories.get(storyId)
  if (!retryAt) return false
  if (retryAt > now) return true
  blockedStories.delete(storyId)
  return false
}

function rotationBlocker(
  authStatus: ReturnType<typeof useCloudAuth>["status"],
  platform: ReturnType<typeof usePlatform>,
  model: ReturnType<typeof useModelSelection>["currentModel"]
) {
  if (authStatus !== "authenticated") return "Authentication is required."
  if (!platform.agent) return "Desktop agent runtime is not available."
  if (!platform.workspace?.createWorktree) return "Desktop worktree runtime is not available."
  if (!platform.workspace.runProjectSetup) return "Desktop setup runtime is not available."
  if (!platform.workspace.onSetupEvent) return "Desktop setup events are not available."
  if (!model) return "Choose a model before starting queued user stories."
  return undefined
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

function eventText(event: ProjectSetupEvent) {
  if (event.type === "exit") return `Setup exited with code ${event.data}`
  return event.data.trim()
}

function setupError(event: ProjectSetupEvent) {
  return (
    event.type === "stderr" ||
    (event.type === "exit" && event.data !== "0")
  )
}

function setupCompleted(event: ProjectSetupEvent) {
  return event.type === "exit" && event.data === "0"
}

function missingPreview(story: UserStory) {
  return (
    (story.status === "in-progress" || story.status === "in-review") &&
    Boolean(story.worktree) &&
    !story.previewUrl
  )
}

function firstPreviewUrl(text: string) {
  const match = text.match(urlPattern)?.[0]
  if (!match) return undefined
  if (match.startsWith("http")) return match
  return `http://${match}`
}

function agentEventText(event: AgentEvent) {
  if (!event.payload || typeof event.payload !== "object") return ""
  if (event.type === "tool") return toolEventText(event.payload)
  if (event.type === "approval") return approvalEventText(event.payload)
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

function toolEventText(payload: object) {
  if ("toolName" in payload && typeof payload.toolName === "string") {
    return `Tool used: ${payload.toolName}`
  }
  if ("name" in payload && typeof payload.name === "string") {
    return `Tool used: ${payload.name}`
  }
  if (
    "hookEventName" in payload &&
    typeof payload.hookEventName === "string"
  ) {
    return `Tool event: ${payload.hookEventName}`
  }
  return "Tool event"
}

function approvalEventText(payload: object) {
  if ("toolName" in payload && typeof payload.toolName === "string") {
    return `Tool approval requested: ${payload.toolName}`
  }
  return "Tool approval requested"
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unable to start queued user story."
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
  return ["error", "aborted", "cancelled", "stopped"].includes(reason)
}

function agentAuthenticationErrorKey(story: UserStory) {
  return `${story.id}:expired-authentication-token`
}
