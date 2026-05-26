import * as React from "react"
import { toast } from "sonner"
import type { AgentEvent } from "@blame/agent-runtime"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import {
  agentEventText,
  agentFlowUpdate,
  completedAgentRun,
  shouldPersistAgentEvent,
} from "@/components/backlog/data/agent-flow"
import type { useBacklogStore } from "@/components/backlog/data/backlog-store"
import { useModelSelection } from "@/components/model/model-selector"
import { useCloudAuth } from "@/context/cloud-auth"
import type { ProjectSetupEvent } from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

const maxConcurrentDevelopmentStories = 3
const blockerRetryDelay = 30_000
const previewRecoveryIntervalMs = 30_000
const setupToastId = "backlog-rotation-setup"
const authToastId = "backlog-agent-auth"
const urlPattern = /\bhttps?:\/\/[^\s"'<>]+|\blocalhost:\d+[^\s"'<>]*/i

export function useBacklogRotation(backlog: ReturnType<typeof useBacklogStore>) {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  const ensureProjectPreviewUrl = platform.workspace?.ensureProjectPreviewUrl
  const startingStoryIds = React.useRef(new Set<number>())
  const blockedStories = React.useRef(new Map<number, number>())
  const reportedBlockers = React.useRef(new Set<string>())
  const reportedAgentErrors = React.useRef(new Set<string>())
  const agentAuthenticationBlockedUntil = React.useRef(0)
  const previewRecoveryStoryIds = React.useRef(new Set<number>())
  const storiesRef = React.useRef(backlog.stories)
  const [, refreshStartingStories] = React.useState(0)

  React.useEffect(() => {
    storiesRef.current = backlog.stories
  }, [backlog.stories])

  React.useEffect(() => {
    blockedStories.current.clear()
    reportedBlockers.current.clear()
    reportedAgentErrors.current.clear()
    agentAuthenticationBlockedUntil.current = 0
    previewRecoveryStoryIds.current.clear()
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
      agentActivities: [],
      agentFinalResponse: null,
      agentStatus: "Running",
      agentLastEvent: `Cline debug log: ${clineLogPath(worktree.worktree, session.sessionId)}`,
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

  const persistRecoveredPreviewUrl = React.useCallback(
    async (story: UserStory, previewUrl: string | null) => {
      if (!previewUrl || previewUrl === story.previewUrl) return
      await backlog.update(story, { previewUrl })
    },
    [backlog]
  )

  const recoverActivePreviews = React.useCallback(
    (stories: UserStory[]) => {
      if (!ensureProjectPreviewUrl) return
      stories.filter(activePreviewStory).forEach((story) => {
        if (!story.worktree || previewRecoveryStoryIds.current.has(story.id)) return
        previewRecoveryStoryIds.current.add(story.id)
        void ensureProjectPreviewUrl({ worktree: story.worktree })
          .then((previewUrl) => persistRecoveredPreviewUrl(story, previewUrl))
          .catch(() => undefined)
          .finally(() => previewRecoveryStoryIds.current.delete(story.id))
      })
    },
    [ensureProjectPreviewUrl, persistRecoveredPreviewUrl]
  )

  React.useEffect(() => {
    if (!ensureProjectPreviewUrl || backlog.loading) return
    recoverActivePreviews(backlog.stories)
    const timer = window.setInterval(
      () => recoverActivePreviews(backlog.stories),
      previewRecoveryIntervalMs
    )
    return () => window.clearInterval(timer)
  }, [backlog.loading, backlog.stories, ensureProjectPreviewUrl, recoverActivePreviews])

  async function persistAgentEvent(story: UserStory, event: AgentEvent) {
    const currentStory = activeStory(story, storiesRef.current)
    const flowUpdate = agentFlowUpdate(currentStory, event)
    const text = agentEventText(event)
    if (!shouldPersistAgentEvent(event, flowUpdate)) return
    if (reportedAgentErrors.current.has(agentAuthenticationErrorKey(story))) return
    if (expiredAuthenticationToken(text)) {
      reportExpiredAuthenticationToken(story, text)
      await backlog.update(currentStory, {
        ...flowUpdate,
        agentLastError: text,
        agentLastEvent: text,
        agentStatus: "Paused",
      })
      return
    }
    if (completedAgentRun(event)) {
      await backlog.update(currentStory, {
        ...flowUpdate,
        agentLastError: null,
        agentLastEvent: text || "Agent completed. Ready for review.",
        agentStatus: null,
        status: "in-review",
      })
      return
    }
    await backlog.update(currentStory, {
      ...flowUpdate,
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

function activeStory(story: UserStory, stories: UserStory[]) {
  return stories.find((currentStory) => currentStory.id === story.id) ?? story
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
    `Backlog item: ${story.title}`,
    "",
    story.summary,
    "",
    "Work in the current worktree when code changes are clearly required.",
    "If the request is a question, analysis, opinion, explanation, or review request, inspect the project if useful and answer in Markdown without editing files.",
    "Only modify files when the request explicitly asks for implementation or when a concrete code change is necessary to satisfy it.",
  ].join("\n")
}

function developmentSystemPrompt() {
  return [
    "You are Blame, an autonomous coding agent running inside a dedicated git worktree.",
    "You must satisfy the backlog item, but not every backlog item requires code changes.",
    "For questions, analysis, opinions, explanations, audits, or reviews, inspect the repository if useful and answer directly without editing files.",
    "Only use write tools when the user explicitly asks for implementation or when a concrete code change is necessary.",
    "Do not wait for extra confirmation before using available write tools when code changes are clearly required.",
    "Your final response must be concise Markdown for the user, with what changed, how to verify it, and any important caveat.",
  ].join(" ")
}

function clineLogPath(worktree: string, sessionId: string) {
  return `${worktree}/.blame/logs/cline-${sessionId}.log`
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

function activePreviewStory(story: UserStory) {
  return (
    (story.status === "in-progress" || story.status === "in-review") &&
    Boolean(story.worktree)
  )
}

function firstPreviewUrl(text: string) {
  const match = text.match(urlPattern)?.[0]
  if (!match) return undefined
  if (match.startsWith("http")) return match
  return `http://${match}`
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

function agentAuthenticationErrorKey(story: UserStory) {
  return `${story.id}:expired-authentication-token`
}
