import * as React from "react"
import { toast } from "sonner"
import { taskComplexityBucket } from "@blame/agent-runtime/telemetry-cohorts"
import type { AgentEvent } from "@blame/agent-runtime"

import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryAgentRunUpdate,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import {
  userStoryDisplayId,
  userStoryReadyForAgent,
} from "@/components/backlog/data/backlog-data"
import { nextCheckpointRunCount } from "@/components/chat/agent-run-checkpoints"
import {
  agentEventText,
  agentFlowUpdate,
  completedAgentRun,
  failedAgentRun,
  resumableAgentFailure,
  shouldPersistAgentEvent,
  terminalAgentRunEvent,
} from "@/components/backlog/data/agent-flow"
import {
  activeAgentEventSubscription,
  subscribeAgentEvents,
} from "@/components/backlog/data/agent-event-stream"
import { persistTerminalAgentUpdate } from "@/components/backlog/data/agent-terminal-outbox"
import {
  agentRunFinalization,
  agentRunOwnsStory,
  agentUpdateKey,
} from "@/components/backlog/data/agent-run-lifecycle"
import { boundedAgentMessage } from "@/components/backlog/data/agent-update-limits"
import { persistAgentRunDiffEndRef } from "@/components/backlog/data/agent-run-diff-end-ref"
import {
  completedClineLog,
  finalAssistantResponse,
} from "@/components/backlog/data/agent-run-recovery"
import type { useBacklogStore } from "@/components/backlog/data/backlog-store"
import { storyPreviewDevtoolsScope } from "@/components/backlog/shared/preview-devtools-scope"
import { useModelSelection } from "@/components/model/model-selector"
import { useCloudAuth } from "@/context/cloud-auth"
import type { HostDependencyReport } from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"
import { effectiveProjectCodePractices } from "@/lib/project-code-practice-preferences"
import { useRuntimePreference } from "@/lib/runtime-preference"
import { showSystemNotification } from "@/lib/system-notifications"
import {
  measurePerformanceOperation,
  recordPerformanceCount,
  recordPerformanceEvent,
  recordPerformanceMetric,
} from "@/lib/performance-diagnostics"

const maxConcurrentDevelopmentStories = 3
const blockerRetryDelay = 30_000
const previewRecoveryIntervalMs = 30_000
const agentCompletionRecoveryIntervalMs = 60_000
const agentCompletionRecoveryGraceMs = 60_000
const agentEventPersistDelayMs = 1_500
const interruptedAgentMessage =
  "Agent interrupted while Blame was offline. Resume when ready."
const setupToastId = "backlog-rotation-setup"
const authToastId = "backlog-agent-auth"
const initializationRetryDelay = 5_000

export function useBacklogRotation(
  backlog: ReturnType<typeof useBacklogStore>
) {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection({ role: "agent" })
  const runtimePreference = useRuntimePreference()
  const ensureProjectPreviewUrl = platform.workspace?.ensureProjectPreviewUrl
  const startingStoryIds = React.useRef(new Set<string>())
  const blockedStories = React.useRef(new Map<string, number>())
  const reportedBlockers = React.useRef(new Set<string>())
  const reportedAgentErrors = React.useRef(new Set<string>())
  const pendingAgentUpdates = React.useRef(
    new Map<string, PendingAgentUpdate>()
  )
  const agentAuthenticationBlockedUntil = React.useRef(0)
  const previewRecoveryStoryIds = React.useRef(new Set<string>())
  const agentCompletionRecoveryStoryIds = React.useRef(new Set<string>())
  const interruptedAgentRecoveryProjectIds = React.useRef(new Set<string>())
  const interruptedAgentRecoveryStoryIds = React.useRef(new Set<string>())
  const storiesRef = React.useRef(backlog.stories)
  const startStoryRef = React.useRef<(story: UserStory) => Promise<void>>(
    async () => undefined
  )
  const reportBlockerRef = React.useRef<
    (story: UserStory, message: string) => void
  >(() => undefined)
  const recoverCompletedAgentRunsRef = React.useRef<
    (stories: UserStory[]) => void
  >(() => undefined)
  const recoverInterruptedAgentRunsRef = React.useRef<
    (stories: UserStory[]) => void
  >(() => undefined)
  const [hostDependenciesDialog, setHostDependenciesDialog] =
    React.useState<HostDependenciesDialogState>()
  const [, refreshStartingStories] = React.useState(0)

  React.useEffect(() => {
    storiesRef.current = backlog.stories
  }, [backlog.stories])

  React.useEffect(() => {
    blockedStories.current.clear()
    reportedBlockers.current.clear()
    reportedAgentErrors.current.clear()
    clearPendingAgentUpdates(pendingAgentUpdates.current)
    agentAuthenticationBlockedUntil.current = 0
    previewRecoveryStoryIds.current.clear()
    agentCompletionRecoveryStoryIds.current.clear()
    interruptedAgentRecoveryStoryIds.current.clear()
  }, [projects.activeProject?.id, selection.currentModel?.id])

  React.useEffect(
    () => () => clearPendingAgentUpdates(pendingAgentUpdates.current),
    []
  )

  async function startStory(story: UserStory) {
    if (!projects.activeProject) return
    const detailedStory = await backlog.loadDetail(story)
    const blocker = rotationBlocker(
      auth.status,
      platform,
      selection.currentModel
    )
    if (blocker) return reportBlocker(detailedStory, blocker)

    const projectInitialization = await createCloudApi(
      auth.apiConnection
    ).projectInitialization(projects.activeProject.id)
    const initialization = projectInitialization.initialization

    if (initialization?.status !== "done" || !initialization.previewManifest) {
      if (projectInitializing(initialization?.status))
        return retryStory(detailedStory)
      reportBlocker(
        detailedStory,
        "Project initialization is required before starting queued user stories."
      )
      return
    }

    const workspace = platform.workspace
    const agent = platform.agent
    if (!workspace || !agent) return

    const dependencies = await workspace.checkHostDependencies({
      runtimeProfile: runtimePreference.profile,
    })
    if (!dependencies.ok) {
      reportHostDependencyBlocker(
        detailedStory,
        dependencies,
        runtimePreference.profile
      )
      return
    }

    const executionId = crypto.randomUUID()
    const storyId = detailedStory.id
    const telemetryCohorts = storyTelemetryCohorts(
      detailedStory,
      selection.currentModel.id,
      selection.currentModel.provider.id
    )
    const worktree = await workspace.createWorktree({
      executionId,
      repositoryRoot: projects.activeProject.path,
      runtimeProfile: runtimePreference.profile,
      storyId,
      storyReference: userStoryDisplayId(detailedStory),
      telemetryCohorts,
      title: detailedStory.title,
    })
    await backlog.update(detailedStory, {
      agentLastEvent: "Worktree ready.",
      branch: worktree.branch,
      status: "in-progress",
      workspaceMode: worktree.workspaceMode,
      worktree: worktree.worktree,
    })
    const preparationPromise = workspace.prepareProjectPreview({
      executionId,
      storyId,
      telemetryCohorts,
      worktree: worktree.worktree,
      previewManifest: initialization.previewManifest,
      runConfigurations: initialization.runConfigurations,
      runConfigurationId: detailedStory.runConfigurationId,
      hostDependenciesChecked: true,
      runtimeProfile: runtimePreference.profile,
    })
    const sessionPromise = agent.sessions.startDevelopment({
      apiConnection: auth.apiConnection,
      providerId: selection.currentModel.provider.id,
      modelId: selection.currentModel.id,
      credentialLabel: selection.currentModel.credentialLabel,
      reasoningEffort: selection.currentVariant,
      autoSendPrompt: false,
      title: detailedStory.title,
      summary: detailedStory.summary,
      codeSelectionAttachments: detailedStory.codeSelectionAttachments ?? [],
      fileAttachments: detailedStory.fileAttachments ?? [],
      cwd: worktree.worktree,
      workspaceRoot: worktree.worktree,
      workspaceMode: worktree.workspaceMode,
      previewDevtoolsScope: storyPreviewDevtoolsScope(detailedStory.id),
      codePractices: effectiveProjectCodePractices(
        projectInitialization.practices
      ),
      executionId,
      storyId,
    })
    void sessionPromise.catch(() => undefined)
    await preparationPromise
    if (
      worktree.workspaceMode === "local-container" &&
      typeof detailedStory.runConfigurationId === "string" &&
      workspace.controlProjectPreview
    ) {
      void workspace
        .controlProjectPreview({
          action: "start",
          configurationId: detailedStory.runConfigurationId,
          worktree: worktree.worktree,
        })
        .then((runtime) => {
          if (runtime.previewUrl) {
            return backlog.update(detailedStory, {
              previewUrl: runtime.previewUrl,
            })
          }
        })
        .catch(() => undefined)
    }
    const session = await sessionPromise
    const run = await backlog.createAgentRun(detailedStory, {
      checkpointRunCount: nextCheckpointRunCount(detailedStory.agentRuns ?? []),
      clineSessionId: session.sessionId,
      executionId,
      kind: "initial",
    })
    const unsubscribeSession = subscribeAgentEvents(
      platform,
      session.sessionId,
      (event) => {
        persistAgentEvent(detailedStory, run, event)
        if (terminalAgentRunEvent(event)) unsubscribeSession()
      },
      executionId
    )

    await backlog.update(detailedStory, {
      agentModelId: selection.currentModel.id,
      agentProviderId: selection.currentModel.provider.id,
      agentActivities: [],
      agentFinalResponse: null,
      agentUsage: null,
      agentStatus: "Running",
      agentLastEvent: `Cline debug log: ${clineLogPath(worktree.worktree, session.sessionId)}`,
      clineSessionId: session.sessionId,
    })
    void agent.sessions.sendDevelopment({
      executionId,
      sessionId: session.sessionId,
      storyId,
      title: detailedStory.title,
      summary: detailedStory.summary,
      codeSelectionAttachments: detailedStory.codeSelectionAttachments ?? [],
      fileAttachments: detailedStory.fileAttachments ?? [],
    })
  }

  function reportBlocker(story: UserStory, message: string) {
    const key = `${story.id}:${message}`
    retryStory(story, blockerRetryDelay)
    if (reportedBlockers.current.has(key)) return
    reportedBlockers.current.add(key)
    toast.error("User story stayed in Agent Queue", {
      description: message,
      id: `${setupToastId}-${story.id}`,
      position: "bottom-right",
    })
  }

  function reportHostDependencyBlocker(
    story: UserStory,
    report: HostDependencyReport,
    runtimeProfile: ReturnType<typeof useRuntimePreference>["profile"]
  ) {
    retryStory(story, blockerRetryDelay)
    setHostDependenciesDialog({
      checking: false,
      report,
      runtimeProfile,
      storyId: story.id,
      storyTitle: story.title,
    })
  }

  async function recheckHostDependencies() {
    const current = hostDependenciesDialog
    if (!current || !platform.workspace?.checkHostDependencies) return
    setHostDependenciesDialog({ ...current, checking: true })
    try {
      const report = await platform.workspace.checkHostDependencies({
        runtimeProfile: current.runtimeProfile,
      })
      if (report.ok) {
        blockedStories.current.delete(current.storyId)
        setHostDependenciesDialog(undefined)
        refreshStartingStories((value) => value + 1)
        return
      }
      setHostDependenciesDialog({ ...current, checking: false, report })
    } catch (error) {
      setHostDependenciesDialog({ ...current, checking: false })
      toast.error("Unable to recheck development requirements", {
        description: errorMessage(error),
        position: "bottom-right",
      })
    }
  }

  function retryStory(story: UserStory, delay = initializationRetryDelay) {
    blockedStories.current.set(story.id, Date.now() + delay)
    window.setTimeout(() => {
      blockedStories.current.delete(story.id)
      refreshStartingStories((value) => value + 1)
    }, delay)
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
        if (!story.worktree || previewRecoveryStoryIds.current.has(story.id))
          return
        previewRecoveryStoryIds.current.add(story.id)
        void ensureProjectPreviewUrl({
          executionId: crypto.randomUUID(),
          storyId: story.id,
          telemetryCohorts: storyTelemetryCohorts(
            story,
            story.agentModelId,
            story.agentProviderId
          ),
          workspaceMode:
            story.workspaceMode ??
            (runtimePreference.profile === "local-container"
              ? "local-container"
              : "cloud-mirror"),
          worktree: story.worktree,
        })
          .then((previewUrl) => persistRecoveredPreviewUrl(story, previewUrl))
          .catch(() => undefined)
          .finally(() => previewRecoveryStoryIds.current.delete(story.id))
      })
    },
    [
      ensureProjectPreviewUrl,
      persistRecoveredPreviewUrl,
      runtimePreference.profile,
    ]
  )

  React.useEffect(() => {
    if (!ensureProjectPreviewUrl || backlog.loading) return
    recoverActivePreviews(backlog.stories)
    const timer = window.setInterval(
      () => recoverActivePreviews(backlog.stories),
      previewRecoveryIntervalMs
    )
    return () => window.clearInterval(timer)
  }, [
    backlog.loading,
    backlog.stories,
    ensureProjectPreviewUrl,
    recoverActivePreviews,
  ])

  function recoverCompletedAgentRuns(stories: UserStory[]) {
    recordPerformanceCount("agent.recovery.poll")
    recordPerformanceMetric("agent.recovery.story_count", stories.length)
    stories.forEach((story) => {
      const run = recoverableAgentRun(story)
      if (!run || agentCompletionRecoveryStoryIds.current.has(story.id)) return
      recordPerformanceCount("agent.recovery.candidate")
      recordPerformanceEvent("agent.recovery.started", {
        runAgeMs: staleAgentRunAge(run),
      })
      agentCompletionRecoveryStoryIds.current.add(story.id)
      void recoverCompletedAgentRun(story, run).finally(() =>
        agentCompletionRecoveryStoryIds.current.delete(story.id)
      )
    })
  }

  function recoverInterruptedAgentRuns(stories: UserStory[]) {
    stories.forEach((story) => {
      const run = recoverableAgentRun(story)
      if (!run || interruptedAgentRecoveryStoryIds.current.has(story.id)) return
      interruptedAgentRecoveryStoryIds.current.add(story.id)
      void recoverInterruptedAgentRun(story, run).finally(() =>
        interruptedAgentRecoveryStoryIds.current.delete(story.id)
      )
    })
  }

  async function recoverInterruptedAgentRun(
    story: UserStory,
    run: UserStoryAgentRun
  ) {
    if (await recoverCompletedAgentRun(story, run)) return
    const currentStory = await backlog.loadDetail(story)
    const currentRun = activeAgentRun(currentStory, run) ?? run
    const completedAt = new Date().toISOString()
    await backlog.finalizeAgentRun(currentStory, currentRun, {
      activities: [],
      agentLastError: interruptedAgentMessage,
      agentLastEvent: interruptedAgentMessage,
      completedAt,
      finalResponse: interruptedAgentMessage,
      outcome: "paused",
      status: "failed",
    })
  }

  async function recoverCompletedAgentRun(
    story: UserStory,
    run: UserStoryAgentRun
  ) {
    return measurePerformanceOperation("agent.recovery.total", async () => {
      return inspectCompletedAgentRun(story, run)
    })
  }

  async function inspectCompletedAgentRun(
    story: UserStory,
    run: UserStoryAgentRun
  ) {
    const log = await clineLog(story, run)
    const nextRun = nextAgentRun(story, run)
    if (
      !completedClineLog(log, run.createdAt, nextRun?.createdAt) &&
      !nextRun
    ) {
      recordPerformanceCount("agent.recovery.incomplete")
      recordPerformanceEvent("agent.recovery.incomplete", {
        logBytes: log.length,
      })
      return false
    }
    const currentStory = await measurePerformanceOperation(
      "agent.recovery.detail",
      () => backlog.loadDetail(story)
    )
    const currentRun = activeAgentRun(currentStory, run) ?? run
    if (currentRun.status !== "running") {
      recordPerformanceCount("agent.recovery.already_terminal")
      return true
    }
    const response = await recoveredFinalResponse(currentStory, currentRun)
    const event: AgentEvent = {
      payload: response ? { text: response } : {},
      type: "done",
    }
    const flowUpdate = agentFlowUpdate(runFlowState(currentRun), event)
    const text = agentEventText(event)
    const storyInput = {
      ...flowUpdate,
      agentLastError: null,
      agentLastEvent: "Agent completed. Ready for review.",
      agentStatus: null,
      status: "in-review" as const,
    }
    const finalization = agentRunFinalization(
      activityUpdates(storyInput),
      storyInput,
      agentRunEventUpdate(flowUpdate, event, text)
    )
    if (!finalization) return false
    await backlog.finalizeAgentRun(currentStory, currentRun, finalization)
    notifyCommentResponseCompleted(currentStory, currentRun, platform)
    recordPerformanceCount("agent.recovery.completed")
    return true
  }

  async function recoveredFinalResponse(
    story: UserStory,
    run: UserStoryAgentRun
  ) {
    const sessionId = run.clineSessionId ?? story.clineSessionId
    if (!sessionId || !platform.agent) return undefined
    const messages = await measurePerformanceOperation(
      "agent.recovery.messages",
      () => platform.agent!.sessions.messages(sessionId)
    ).catch(() => undefined)
    recordPerformanceMetric(
      "agent.recovery.message_count",
      recoveredMessageCount(messages)
    )
    return finalAssistantResponse(
      messages,
      run.createdAt,
      nextAgentRun(story, run)?.createdAt
    )
  }

  async function clineLog(story: UserStory, run: UserStoryAgentRun) {
    const workspace = platform.workspace
    const sessionId = run.clineSessionId ?? story.clineSessionId
    if (!workspace || !story.worktree || !sessionId) return ""
    const log = await measurePerformanceOperation("agent.recovery.log", () =>
      workspace.readFile({
        root: story.worktree!,
        path: clineLogRelativePath(sessionId),
      })
    ).catch(() => "")
    recordPerformanceMetric("agent.recovery.log_bytes", log.length)
    return log
  }

  React.useEffect(() => {
    recoverCompletedAgentRunsRef.current = recoverCompletedAgentRuns
    recoverInterruptedAgentRunsRef.current = recoverInterruptedAgentRuns
  })

  React.useEffect(() => {
    if (!platform.workspace || backlog.loading) return
    const projectId = backlog.projectId
    if (!projectId || interruptedAgentRecoveryProjectIds.current.has(projectId))
      return
    interruptedAgentRecoveryProjectIds.current.add(projectId)
    recoverInterruptedAgentRunsRef.current(storiesRef.current)
  }, [backlog.loading, backlog.projectId, platform.workspace])

  React.useEffect(() => {
    if (!platform.workspace || backlog.loading) return
    const timer = window.setInterval(
      () => recoverCompletedAgentRunsRef.current(storiesRef.current),
      agentCompletionRecoveryIntervalMs
    )
    return () => window.clearInterval(timer)
  }, [backlog.loading, platform.workspace])

  async function persistAgentEvent(
    story: UserStory,
    run: UserStoryAgentRun | undefined,
    event: AgentEvent
  ) {
    const currentStory = activeStory(story, storiesRef.current)
    const flowUpdate = agentFlowUpdate(currentStory, event)
    const text = agentEventText(event)
    const runInput = agentRunEventUpdate(flowUpdate, event, text)
    if (!shouldPersistAgentEvent(event, flowUpdate)) return
    if (reportedAgentErrors.current.has(agentAuthenticationErrorKey(story)))
      return
    if (expiredAuthenticationToken(text)) {
      reportExpiredAuthenticationToken(story, text)
      persistAgentUpdate(
        currentStory,
        {
          ...flowUpdate,
          agentLastError: boundedAgentMessage(
            text,
            "Agent authentication failed"
          ),
          agentLastEvent: boundedAgentMessage(
            text,
            "Agent authentication failed"
          ),
          agentStatus: "Paused",
        },
        run,
        runInput,
        true
      )
      return
    }
    if (completedAgentRun(event)) {
      notifyCommentResponseCompleted(currentStory, run, platform)
      await persistTerminalAgentTransition(
        currentStory,
        {
          ...flowUpdate,
          agentLastError: null,
          agentLastEvent: "Agent completed. Ready for review.",
          agentStatus: null,
          status: "in-review",
        },
        run,
        runInput
      )
      return
    }
    if (failedAgentRun(event)) {
      const resumable = resumableAgentFailure(text)
      await persistTerminalAgentTransition(
        currentStory,
        {
          ...flowUpdate,
          agentLastError: boundedAgentMessage(text, "Agent session failed"),
          agentLastEvent: boundedAgentMessage(text, "Agent session failed"),
          agentStatus: resumable ? "Paused" : null,
          status: resumable ? "in-progress" : "in-review",
        },
        run,
        runInput
      )
      return
    }
    persistAgentUpdate(
      currentStory,
      {
        ...flowUpdate,
        agentLastError:
          event.type === "error"
            ? boundedAgentMessage(text, "Agent session failed")
            : undefined,
        agentLastEvent: boundedAgentMessage(text, event.type),
      },
      run,
      runInput,
      terminalAgentRunEvent(event)
    )
  }

  function persistAgentUpdate(
    story: UserStory,
    input: UserStoryUpdate,
    run: UserStoryAgentRun | undefined,
    runInput: UserStoryAgentRunUpdate,
    immediate: boolean
  ) {
    const storyInput = agentRunOwnsStory(story, run) ? input : {}
    const nextStory = updateLocalStory(story, storyInput, run, runInput)
    if (immediate) {
      void flushAgentUpdate(nextStory, run, storyInput, runInput).catch(
        reportAgentPersistenceError
      )
      return
    }
    queueAgentUpdate(nextStory, run, storyInput, runInput)
  }

  async function persistTerminalAgentTransition(
    story: UserStory,
    input: UserStoryUpdate,
    run: UserStoryAgentRun | undefined,
    runInput: UserStoryAgentRunUpdate
  ) {
    const storyInput = agentRunOwnsStory(story, run) ? input : {}
    const nextStory = updateLocalStory(story, storyInput, run, runInput)
    recordPerformanceEvent("agent.transition.local_terminal_update", {
      eventType: runInput.status ?? "terminal",
    })
    void flushAgentUpdate(nextStory, run, storyInput, runInput).catch(
      reportAgentPersistenceError
    )
    if (run && !run.diffEndRef) {
      void persistAgentRunDiffEndRef(story, run, platform, backlog).catch(
        reportAgentPersistenceError
      )
    }
  }

  function updateLocalStory(
    story: UserStory,
    input: UserStoryUpdate,
    run?: UserStoryAgentRun,
    runInput?: UserStoryAgentRunUpdate
  ) {
    const currentStory = activeStory(story, storiesRef.current)
    const nextStory = { ...currentStory, ...definedUpdate(input) }
    storiesRef.current = storiesRef.current.map((current) =>
      current.id === story.id ? nextStory : current
    )
    backlog.updateAgentLocal(currentStory, input, run, runInput)
    return nextStory
  }

  function queueAgentUpdate(
    story: UserStory,
    run: UserStoryAgentRun | undefined,
    input: UserStoryUpdate,
    runInput: UserStoryAgentRunUpdate
  ) {
    const key = agentUpdateKey(story, run)
    const pending = pendingAgentUpdates.current.get(key)
    if (pending) window.clearTimeout(pending.timer)
    const update = pendingAgentUpdate(pending, input, run, runInput)
    const timer = window.setTimeout(() => {
      pendingAgentUpdates.current.delete(key)
      void persistQueuedAgentUpdate(story, update).catch(() => undefined)
    }, agentEventPersistDelayMs)
    pendingAgentUpdates.current.set(key, { ...update, timer })
  }

  function flushAgentUpdate(
    story: UserStory,
    run: UserStoryAgentRun | undefined,
    input: UserStoryUpdate,
    runInput: UserStoryAgentRunUpdate
  ) {
    const key = agentUpdateKey(story, run)
    const pending = pendingAgentUpdates.current.get(key)
    if (pending) window.clearTimeout(pending.timer)
    pendingAgentUpdates.current.delete(key)
    const update = pendingAgentUpdate(pending, input, run, runInput)
    return persistTerminalAgentUpdate(window.localStorage, story, update, () =>
      persistTerminalQueuedAgentUpdate(story, update)
    )
  }

  function persistTerminalQueuedAgentUpdate(
    story: UserStory,
    update: QueuedAgentUpdate
  ) {
    const finalization = agentRunFinalization(
      update.activities,
      update.input,
      update.runInput,
      pausedAgentUpdate(update.input) ? "paused" : "review"
    )
    if (!update.run || !finalization) {
      return persistQueuedAgentUpdate(story, update)
    }
    return backlog.finalizeAgentRun(story, update.run, finalization)
  }

  async function persistQueuedAgentUpdate(
    story: UserStory,
    update: QueuedAgentUpdate
  ) {
    let nextStory = activeStory(story, storiesRef.current)
    const metadata = agentMetadataUpdate(update.input)
    if (
      agentRunOwnsStory(
        activeStory(nextStory, storiesRef.current),
        update.run
      ) &&
      Object.keys(definedUpdate(metadata)).length
    ) {
      nextStory = await backlog.update(
        activeStory(nextStory, storiesRef.current),
        metadata
      )
    }
    if (update.activities.length) {
      if (update.run) {
        await backlog.updateAgentRun(nextStory, update.run, {
          agentActivityUpdates: update.activities,
        })
      } else if (
        agentRunOwnsStory(
          activeStory(nextStory, storiesRef.current),
          update.run
        )
      ) {
        nextStory = await backlog.update(
          activeStory(nextStory, storiesRef.current),
          { agentActivityUpdates: update.activities }
        )
      }
    }
    if (update.run) {
      const runMetadata = agentRunMetadataUpdate(update.runInput)
      if (Object.keys(definedUpdate(runMetadata)).length) {
        await backlog.updateAgentRun(nextStory, update.run, runMetadata)
      }
    }
    return nextStory
  }

  function reportExpiredAuthenticationToken(story: UserStory, message: string) {
    const key = agentAuthenticationErrorKey(story)
    if (reportedAgentErrors.current.has(key)) return
    agentAuthenticationBlockedUntil.current = Date.now() + blockerRetryDelay
    window.setTimeout(
      () => refreshStartingStories((value) => value + 1),
      blockerRetryDelay
    )
    reportedAgentErrors.current.add(key)
    toast.error("Agent authentication expired", {
      description: `${message} Reconnect the selected provider, then restart the story.`,
      id: `${authToastId}-${story.id}`,
      position: "bottom-right",
    })
  }

  React.useEffect(() => {
    startStoryRef.current = startStory
    reportBlockerRef.current = reportBlocker
  })

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
      void startStoryRef
        .current(story)
        .catch((error) => reportBlockerRef.current(story, errorMessage(error)))
        .finally(() => {
          startingStoryIds.current.delete(story.id)
          refreshStartingStories((value) => value + 1)
        })
    })
    refreshStartingStories((value) => value + 1)
  }, [
    auth.status,
    backlog.loading,
    backlog.projectId,
    backlog.stories,
    projects.activeProject,
  ])

  return {
    hostDependenciesDialog: {
      checking: Boolean(hostDependenciesDialog?.checking),
      onOpenChange(open: boolean) {
        if (!open) setHostDependenciesDialog(undefined)
      },
      onRecheck: recheckHostDependencies,
      open: Boolean(hostDependenciesDialog),
      report: hostDependenciesDialog?.report,
      storyTitle: hostDependenciesDialog?.storyTitle,
    },
  }
}

function activeStory(story: UserStory, stories: UserStory[]) {
  return stories.find((currentStory) => currentStory.id === story.id) ?? story
}

function activeAgentRun(story: UserStory, run: UserStoryAgentRun) {
  return story.agentRuns?.find((currentRun) => currentRun.id === run.id)
}

function reportAgentPersistenceError(error: unknown) {
  console.error("Failed to persist agent update.", error)
}

type QueuedAgentUpdate = {
  activities: UserStoryAgentActivity[]
  input: UserStoryUpdate
  run?: UserStoryAgentRun
  runInput: UserStoryAgentRunUpdate
}

type PendingAgentUpdate = QueuedAgentUpdate & {
  timer: number
}

type HostDependenciesDialogState = {
  checking: boolean
  report: HostDependencyReport
  runtimeProfile: ReturnType<typeof useRuntimePreference>["profile"]
  storyId: string
  storyTitle: string
}

function clearPendingAgentUpdates(updates: Map<string, PendingAgentUpdate>) {
  updates.forEach((update) => window.clearTimeout(update.timer))
  updates.clear()
}

function definedUpdate(input: object) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

function pendingAgentUpdate(
  pending: QueuedAgentUpdate | undefined,
  input: UserStoryUpdate,
  run: UserStoryAgentRun | undefined,
  runInput: UserStoryAgentRunUpdate
): QueuedAgentUpdate {
  return {
    activities: nextAgentActivities(
      pending?.activities ?? [],
      activityUpdates(input)
    ),
    input: { ...pending?.input, ...input },
    run: pending?.run ?? run,
    runInput: { ...pending?.runInput, ...runInput },
  }
}

function nextAgentActivities(
  activities: UserStoryAgentActivity[],
  updates: UserStoryAgentActivity[]
) {
  return updates.reduce(upsertAgentActivity, activities)
}

function activityUpdates(input: UserStoryUpdate) {
  return input.agentActivityUpdates ?? activityUpdateList(input.agentActivity)
}

function activityUpdateList(
  activity: UserStoryAgentActivity | null | undefined
) {
  return activity ? [activity] : []
}

function upsertAgentActivity(
  activities: UserStoryAgentActivity[],
  activity: UserStoryAgentActivity
) {
  const exists = activities.some((item) => item.id === activity.id)
  if (!exists) return [...activities, activity]
  return activities.map((item) => (item.id === activity.id ? activity : item))
}

function agentMetadataUpdate(input: UserStoryUpdate): UserStoryUpdate {
  const { agentActivities, agentActivity, agentActivityUpdates, ...metadata } =
    input
  void agentActivities
  void agentActivity
  void agentActivityUpdates
  return metadata
}

function pausedAgentUpdate(input: UserStoryUpdate) {
  return input.status === "in-progress" && input.agentStatus === "Paused"
}

function agentRunMetadataUpdate(
  input: UserStoryAgentRunUpdate
): UserStoryAgentRunUpdate {
  const { activities, agentActivity, agentActivityUpdates, ...metadata } = input
  void activities
  void agentActivity
  void agentActivityUpdates
  return metadata
}

function agentRunEventUpdate(
  update: UserStoryUpdate,
  event: AgentEvent,
  text: string
): UserStoryAgentRunUpdate {
  const input: UserStoryAgentRunUpdate = {}
  if (update.agentActivity) input.agentActivity = update.agentActivity
  if (update.agentActivityUpdates)
    input.agentActivityUpdates = update.agentActivityUpdates
  if (update.agentUsage) input.usage = update.agentUsage
  if (update.agentFinalResponse !== undefined)
    input.finalResponse = update.agentFinalResponse
  if (update.agentSessionSummary !== undefined)
    input.sessionSummary = update.agentSessionSummary
  if (completedAgentRun(event)) {
    input.status = "completed"
    input.completedAt = new Date().toISOString()
  }
  if (failedAgentRun(event)) {
    input.status = "failed"
    input.finalResponse = update.agentFinalResponse ?? text
    input.completedAt = new Date().toISOString()
  }
  return input
}

function notifyCommentResponseCompleted(
  story: UserStory,
  run: UserStoryAgentRun | undefined,
  platform: ReturnType<typeof usePlatform>
) {
  if (!run?.commentId) return
  void showSystemNotification(platform, {
    body: `${userStoryDisplayId(story)} · ${story.title}`,
    title: "Agent replied to a comment",
  })
}

function runningStories(stories: UserStory[]) {
  return stories.filter(
    (story) => story.status === "in-progress" && story.agentStatus !== "Paused"
  ).length
}

function queuedStories(
  stories: UserStory[],
  startingStoryIds: Set<string>,
  blockedStories: Map<string, number>
) {
  const now = Date.now()
  return stories
    .filter(
      (story) =>
        userStoryReadyForAgent(story) &&
        !startingStoryIds.has(story.id) &&
        !blocked(story.id, blockedStories, now)
    )
    .sort(
      (left, right) =>
        new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
    )
}

function blocked(
  storyId: string,
  blockedStories: Map<string, number>,
  now: number
) {
  const retryAt = blockedStories.get(storyId)
  if (!retryAt) return false
  if (retryAt > now) return true
  blockedStories.delete(storyId)
  return false
}

function projectInitializing(status: string | undefined) {
  return !status || status === "pending" || status === "running"
}

function rotationBlocker(
  authStatus: ReturnType<typeof useCloudAuth>["status"],
  platform: ReturnType<typeof usePlatform>,
  model: ReturnType<typeof useModelSelection>["currentModel"]
) {
  if (authStatus !== "authenticated") return "Authentication is required."
  if (!platform.agent) return "Desktop agent runtime is not available."
  if (!platform.workspace?.createWorktree)
    return "Desktop worktree runtime is not available."
  if (!platform.workspace.checkHostDependencies)
    return "Desktop host dependency checks are not available."
  if (!platform.workspace.prepareProjectPreview)
    return "Desktop preview preparation is not available."
  if (!model) return "Choose a model before starting queued user stories."
  return undefined
}

function recoverableAgentRun(story: UserStory) {
  const runs = new Map(
    (story.runningAgentRuns ?? []).map((run) => [run.id, run])
  )
  story.agentRuns?.forEach((run) => runs.set(run.id, run))
  return [...runs.values()].findLast(
    (run) =>
      run.status === "running" &&
      !run.finalResponse &&
      staleAgentRun(run) &&
      Boolean(run.clineSessionId ?? story.clineSessionId) &&
      !activeAgentEventSubscription(
        run.clineSessionId ?? story.clineSessionId ?? undefined
      )
  )
}

function nextAgentRun(story: UserStory, run: UserStoryAgentRun) {
  return story.agentRuns?.find(
    (candidate) =>
      candidate.id !== run.id &&
      Date.parse(candidate.createdAt) > Date.parse(run.createdAt)
  )
}

function runFlowState(run: UserStoryAgentRun) {
  return {
    agentActivities: run.activities,
    agentFinalResponse: run.finalResponse,
    agentSessionSummary: run.sessionSummary,
    agentUsage: run.usage,
  }
}

function staleAgentRun(run: UserStoryAgentRun) {
  return staleAgentRunAge(run) >= agentCompletionRecoveryGraceMs
}

function staleAgentRunAge(run: UserStoryAgentRun) {
  const updatedAt = run.updatedAt ?? run.createdAt
  return Math.max(0, Date.now() - new Date(updatedAt).getTime())
}

function recoveredMessageCount(value: unknown) {
  if (Array.isArray(value)) return value.length
  if (!value || typeof value !== "object") return 0
  const messages = (value as Record<string, unknown>).messages
  return Array.isArray(messages) ? messages.length : 0
}

function storyTaskComplexity(story: UserStory) {
  const promptLength = story.title.length + story.summary.length
  const attachmentCount =
    (story.codeSelectionAttachments?.length ?? 0) +
    (story.fileAttachments?.length ?? 0)
  return taskComplexityBucket(promptLength, attachmentCount)
}

function storyTelemetryCohorts(
  story: UserStory,
  modelId: string | null | undefined,
  providerId: string | null | undefined
) {
  if (!modelId || !providerId) return undefined
  return {
    agentStrategy: "multi_agent" as const,
    modelId,
    providerId,
    taskComplexityBucket: storyTaskComplexity(story),
  }
}

function clineLogPath(worktree: string, sessionId: string) {
  return `${worktree}/.blame/logs/cline-${sessionId}.log`
}

function clineLogRelativePath(sessionId: string) {
  return `.blame/logs/cline-${sessionId}.log`
}

function activePreviewStory(story: UserStory) {
  return (
    (story.status === "in-progress" || story.status === "in-review") &&
    Boolean(story.worktree) &&
    Boolean(story.previewUrl || story.runConfigurationId)
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to start queued user story."
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
