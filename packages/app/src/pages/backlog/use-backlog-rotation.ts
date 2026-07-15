import * as React from "react"
import { toast } from "sonner"
import { taskComplexityBucket } from "@blame/agent-runtime/telemetry-cohorts"
import type {
  AgentEvent,
  PreviewManifest,
  RepairProjectInitializationResult,
} from "@blame/agent-runtime"

import type {
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryAgentRunUpdate,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import { userStoryDisplayId } from "@/components/backlog/data/backlog-data"
import {
  agentEventText,
  agentFlowUpdate,
  completedAgentRun,
  failedAgentRun,
  shouldPersistAgentEvent,
  terminalAgentRunEvent,
} from "@/components/backlog/data/agent-flow"
import { subscribeAgentEvents } from "@/components/backlog/data/agent-event-stream"
import { persistTerminalAgentUpdate } from "@/components/backlog/data/agent-terminal-outbox"
import {
  completedClineLog,
  finalAssistantResponse,
} from "@/components/backlog/data/agent-run-recovery"
import type { useBacklogStore } from "@/components/backlog/data/backlog-store"
import { storyPreviewDevtoolsScope } from "@/components/backlog/shared/preview-devtools-scope"
import { useModelSelection } from "@/components/model/model-selector"
import { useCloudAuth } from "@/context/cloud-auth"
import type { CloudProjectInitialization } from "@/context/cloud-auth"
import type {
  HostDependencyReport,
  ProjectSetupEvent,
} from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"
import { showSystemNotification } from "@/lib/system-notifications"
import { diagnoseAndRepairProjectInitialization } from "./project-initialization-repair"

const maxConcurrentDevelopmentStories = 3
const blockerRetryDelay = 30_000
const previewRecoveryIntervalMs = 30_000
const agentCompletionRecoveryIntervalMs = 10_000
const agentCompletionRecoveryGraceMs = 15_000
const agentEventPersistDelayMs = 1_500
const interruptedAgentMessage =
  "Agent interrupted while Blame was offline. Resume when ready."
const setupToastId = "backlog-rotation-setup"
const authToastId = "backlog-agent-auth"
const initializationRepairToastId = "backlog-initialization-repair"
const initializationRepairFinalToastDuration = 15_000
const initializationRetryDelay = 5_000

export function useBacklogRotation(
  backlog: ReturnType<typeof useBacklogStore>
) {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection({ role: "agent" })
  const alternativeSelection = useModelSelection({ role: "alternative" })
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
  const initializationRepairRunIds = React.useRef(new Set<string>())
  const storiesRef = React.useRef(backlog.stories)
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
    initializationRepairRunIds.current.clear()
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

    if (
      initialization?.status !== "done" ||
      !initialization.setupScript ||
      !initialization.dockerCompose
    ) {
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
      setupScript: initialization.setupScript,
    })
    if (!dependencies.ok) {
      reportHostDependencyBlocker(
        detailedStory,
        dependencies,
        initialization.setupScript
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
      storyId,
      storyReference: userStoryDisplayId(detailedStory),
      telemetryCohorts,
      title: detailedStory.title,
    })
    await backlog.update(detailedStory, {
      agentLastEvent: "Project preview setup starting.",
      branch: worktree.branch,
      status: "in-progress",
      worktree: worktree.worktree,
    })
    const setup = await workspace.runProjectSetup({
      executionId,
      storyId,
      telemetryCohorts,
      worktree: worktree.worktree,
      setupScript: initialization.setupScript,
      dockerCompose: initialization.dockerCompose,
      hostDependenciesChecked: true,
    })
    backlog.setStorySetupInitializing(detailedStory, true)
    const unsubscribeSetup = workspace.onSetupEvent(setup.runId, (event) => {
      void handleSetupEvent(
        detailedStory,
        setup.runId,
        event,
        worktree.worktree,
        initialization,
        executionId
      )
      if (event.type === "exit") unsubscribeSetup()
    })
    const session = await agent.sessions.startDevelopment({
      apiConnection: auth.apiConnection,
      providerId: selection.currentModel.provider.id,
      modelId: selection.currentModel.id,
      credentialLabel: selection.currentModel.credentialLabel,
      reasoningEffort: selection.currentVariant,
      contextCompressionMode: selection.contextCompressionMode,
      autoSendPrompt: false,
      title: detailedStory.title,
      summary: detailedStory.summary,
      codeSelectionAttachments: detailedStory.codeSelectionAttachments ?? [],
      fileAttachments: detailedStory.fileAttachments ?? [],
      cwd: worktree.worktree,
      workspaceRoot: worktree.worktree,
      previewDevtoolsScope: storyPreviewDevtoolsScope(detailedStory.id),
      codePractices: projectInitialization.practices,
      executionId,
      storyId,
    })
    const run = await backlog.createAgentRun(detailedStory, {
      clineSessionId: session.sessionId,
      kind: "initial",
    })
    const unsubscribeSession = subscribeAgentEvents(
      platform,
      session.sessionId,
      (event) => {
        persistAgentEvent(detailedStory, run, event)
        if (terminalAgentRunEvent(event)) unsubscribeSession()
      }
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
    setupScript: string
  ) {
    retryStory(story, blockerRetryDelay)
    setHostDependenciesDialog({
      checking: false,
      report,
      setupScript,
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
        setupScript: current.setupScript,
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

  async function persistSetupEvent(
    story: UserStory,
    event: ProjectSetupEvent,
    worktree: string
  ) {
    const text = eventText(event)
    const previewUrl = await setupPreviewUrl(event, worktree)
    const recovered = Boolean(
      previewUrl && setupError(event) && (await projectRuntimeHealthy(worktree))
    )
    if (event.type === "exit") backlog.setStorySetupInitializing(story, false)
    await backlog.update(story, {
      agentLastError: setupError(event) && !recovered ? text : undefined,
      agentLastEvent: recovered
        ? "Project preview containers are running."
        : text,
      previewUrl,
    })
    return { recovered }
  }

  async function setupPreviewUrl(event: ProjectSetupEvent, worktree: string) {
    if (!setupFinished(event)) return undefined
    try {
      return (await projectPreviewUrl(worktree)) ?? undefined
    } catch {
      return undefined
    }
  }

  async function handleSetupEvent(
    story: UserStory,
    runId: string,
    event: ProjectSetupEvent,
    worktree: string,
    initialization: CloudProjectInitialization,
    executionId: string
  ) {
    const result = await persistSetupEvent(story, event, worktree)
    if (setupError(event) && event.type === "exit" && !result.recovered) {
      await repairFailedSetup(
        story,
        runId,
        event,
        worktree,
        initialization,
        executionId
      )
    }
  }

  async function repairFailedSetup(
    story: UserStory,
    runId: string,
    event: ProjectSetupEvent,
    worktree: string,
    initialization: CloudProjectInitialization,
    executionId: string
  ) {
    if (initializationRepairRunIds.current.has(runId)) return
    initializationRepairRunIds.current.add(runId)
    try {
      toast.loading("Diagnosing failed project initialization", {
        description: story.title,
        id: initializationRepairToast(story),
        position: "bottom-right",
      })
      await backlog.update(story, {
        agentLastEvent: "Diagnosing failed project initialization.",
      })
      await diagnoseAndRetryFailedSetup(
        story,
        event,
        worktree,
        initialization,
        executionId
      )
    } catch (error) {
      const message = `Initialization diagnosis failed: ${errorMessage(error)}`
      toast.error("Initialization diagnosis failed", {
        description: errorMessage(error),
        duration: initializationRepairFinalToastDuration,
        id: initializationRepairToast(story),
        position: "bottom-right",
      })
      await backlog.update(story, {
        agentLastError: message,
        agentLastEvent: message,
      })
    }
  }

  async function diagnoseAndRetryFailedSetup(
    story: UserStory,
    event: ProjectSetupEvent,
    worktree: string,
    initialization: CloudProjectInitialization,
    executionId: string
  ) {
    const result = await diagnoseAndRepairProjectInitialization({
      apiConnection: auth.apiConnection,
      executionId,
      platform,
      projectId: initialization.projectId,
      providerId: alternativeSelection.currentModel!.provider.id,
      modelId: alternativeSelection.currentModel!.id,
      credentialLabel: alternativeSelection.currentModel!.credentialLabel,
      reasoningEffort: alternativeSelection.currentVariant,
      worktree,
      previewManifest: initialization.previewManifest as PreviewManifest | null,
      setupScript: initialization.setupScript!,
      storyId: story.id,
      dockerCompose: initialization.dockerCompose!,
      runConfigurations: initialization.runConfigurations,
      launchError: eventText(event),
    })
    await persistInitializationDiagnosis(story, result)
    if (!repairArtifacts(result)) {
      toast.error("Initialization could not be repaired automatically", {
        description: result.reason,
        duration: initializationRepairFinalToastDuration,
        id: initializationRepairToast(story),
        position: "bottom-right",
      })
      return
    }
    toast.success("Initialization repaired, retrying preview", {
      description: result.reason,
      id: initializationRepairToast(story),
      position: "bottom-right",
    })
    await runRepairedSetup(
      story,
      worktree,
      result.setupScript,
      result.dockerCompose,
      executionId
    )
  }

  function persistInitializationDiagnosis(
    story: UserStory,
    result: RepairProjectInitializationResult
  ) {
    return backlog.update(story, {
      agentLastError:
        result.classification === "repairable_initialization"
          ? null
          : result.reason,
      agentLastEvent: `Initialization diagnosis: ${result.reason}`,
    })
  }

  async function runRepairedSetup(
    story: UserStory,
    worktree: string,
    setupScript: string,
    dockerCompose: string,
    executionId: string
  ) {
    const workspace = platform.workspace
    if (!workspace) return
    backlog.setStorySetupInitializing(story, true)
    const setup = await workspace.runProjectSetup({
      executionId,
      storyId: story.id,
      worktree,
      setupScript,
      dockerCompose,
      hostDependenciesChecked: true,
    })
    const unsubscribe = workspace.onSetupEvent(setup.runId, (event) => {
      void handleRepairedSetupEvent(story, event, worktree, unsubscribe)
    })
  }

  async function handleRepairedSetupEvent(
    story: UserStory,
    event: ProjectSetupEvent,
    worktree: string,
    unsubscribe: () => void
  ) {
    const result = await persistSetupEvent(story, event, worktree)
    if (event.type !== "exit") return
    const completed = setupCompleted(event) || result.recovered
    toast[completed ? "success" : "error"](
      completed
        ? "Preview recovered after initialization repair"
        : "Preview still fails after initialization repair",
      {
        duration: initializationRepairFinalToastDuration,
        id: initializationRepairToast(story),
        position: "bottom-right",
      }
    )
    unsubscribe()
  }

  async function projectPreviewUrl(worktree: string) {
    return platform.workspace?.resolveProjectPreviewUrl?.({ worktree })
  }

  async function projectRuntimeHealthy(worktree: string) {
    return platform.workspace?.projectRuntimeHealthy?.({ worktree }) ?? false
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
      stories
        .filter((story) =>
          activePreviewStory(story, backlog.setupInitializingStoryIds)
        )
        .forEach((story) => {
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
            worktree: story.worktree,
          })
            .then((previewUrl) => persistRecoveredPreviewUrl(story, previewUrl))
            .catch(() => undefined)
            .finally(() => previewRecoveryStoryIds.current.delete(story.id))
        })
    },
    [
      backlog.setupInitializingStoryIds,
      ensureProjectPreviewUrl,
      persistRecoveredPreviewUrl,
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
    stories.forEach((story) => {
      const run = recoverableAgentRun(story)
      if (!run || agentCompletionRecoveryStoryIds.current.has(story.id)) return
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
    const detailedStory = await backlog.loadDetail(story)
    const currentStory = detailedStory
    const currentRun = activeAgentRun(currentStory, run) ?? run
    const completedAt = new Date().toISOString()
    await backlog.updateAgentRun(currentStory, currentRun, {
      completedAt,
      finalResponse: interruptedAgentMessage,
      status: "failed",
    })
    if (!activelyRunningStory(currentStory)) return
    await backlog.update(currentStory, {
      agentLastError: interruptedAgentMessage,
      agentLastEvent: interruptedAgentMessage,
      agentStatus: "Paused",
      status: "in-progress",
    })
  }

  async function recoverCompletedAgentRun(
    story: UserStory,
    run: UserStoryAgentRun
  ) {
    const detailedStory = await backlog.loadDetail(story)
    const currentStory = detailedStory
    const currentRun = activeAgentRun(currentStory, run) ?? run
    if (currentRun.status !== "running") return true
    const log = await clineLog(currentStory, currentRun)
    const response = await recoveredFinalResponse(currentStory, currentRun)
    const nextRun = nextAgentRun(currentStory, currentRun)
    if (
      !completedClineLog(log, currentRun.createdAt, nextRun?.createdAt) &&
      !nextRun
    ) {
      return false
    }
    const event: AgentEvent = {
      payload: response ? { text: response } : {},
      type: "done",
    }
    const flowUpdate = agentFlowUpdate(currentStory, event)
    const text = agentEventText(event)
    if (!activelyRunningStory(currentStory)) {
      await backlog.updateAgentRun(currentStory, currentRun, {
        completedAt: new Date().toISOString(),
        finalResponse: response,
        status: "completed",
      })
      notifyCommentResponseCompleted(currentStory, currentRun, platform)
      return true
    }
    persistAgentUpdate(
      currentStory,
      {
        ...flowUpdate,
        agentLastError: null,
        agentLastEvent: "Agent completed. Ready for review.",
        agentStatus: null,
        status: "in-review",
      },
      currentRun,
      agentRunEventUpdate(flowUpdate, event, text),
      true
    )
    notifyCommentResponseCompleted(currentStory, currentRun, platform)
    return true
  }

  async function recoveredFinalResponse(
    story: UserStory,
    run: UserStoryAgentRun
  ) {
    const sessionId = run.clineSessionId ?? story.clineSessionId
    if (!sessionId || !platform.agent) return undefined
    const messages = await platform.agent.sessions
      .messages(sessionId)
      .catch(() => undefined)
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
    return workspace
      .readFile({
        root: story.worktree,
        path: clineLogRelativePath(sessionId),
      })
      .catch(() => "")
  }

  React.useEffect(() => {
    if (!platform.workspace || backlog.loading) return
    const projectId = backlog.projectId
    if (!projectId || interruptedAgentRecoveryProjectIds.current.has(projectId))
      return
    interruptedAgentRecoveryProjectIds.current.add(projectId)
    recoverInterruptedAgentRuns(storiesRef.current)
  }, [backlog.loading, backlog.projectId, platform.workspace])

  React.useEffect(() => {
    if (!platform.workspace || backlog.loading) return
    const timer = window.setInterval(
      () => recoverCompletedAgentRuns(storiesRef.current),
      agentCompletionRecoveryIntervalMs
    )
    return () => window.clearInterval(timer)
  }, [backlog.loading, platform.workspace])

  function persistAgentEvent(
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
          agentLastError: text,
          agentLastEvent: text,
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
      persistAgentUpdate(
        currentStory,
        {
          ...flowUpdate,
          agentLastError: null,
          agentLastEvent: text || "Agent completed. Ready for review.",
          agentStatus: null,
          status: "in-review",
        },
        run,
        runInput,
        true
      )
      return
    }
    if (failedAgentRun(event)) {
      persistAgentUpdate(
        currentStory,
        {
          ...flowUpdate,
          agentLastError: text || "Agent session failed",
          agentLastEvent: text || "Agent session failed",
          agentStatus: null,
          status: "in-review",
        },
        run,
        runInput,
        true
      )
      return
    }
    persistAgentUpdate(
      currentStory,
      {
        ...flowUpdate,
        agentLastError:
          event.type === "error" ? text || "Agent session failed" : undefined,
        agentLastEvent: text || event.type,
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
    const nextStory = updateLocalStory(story, input)
    if (run) backlog.updateAgentRunLocal(nextStory, run, runInput)
    if (immediate) {
      void flushAgentUpdate(nextStory, run, input, runInput).catch(
        reportAgentPersistenceError
      )
      return
    }
    queueAgentUpdate(nextStory, run, input, runInput)
  }

  function updateLocalStory(story: UserStory, input: UserStoryUpdate) {
    const currentStory = activeStory(story, storiesRef.current)
    const nextStory = { ...currentStory, ...definedUpdate(input) }
    storiesRef.current = storiesRef.current.map((current) =>
      current.id === story.id ? nextStory : current
    )
    backlog.updateLocal(currentStory, input)
    return nextStory
  }

  function queueAgentUpdate(
    story: UserStory,
    run: UserStoryAgentRun | undefined,
    input: UserStoryUpdate,
    runInput: UserStoryAgentRunUpdate
  ) {
    const pending = pendingAgentUpdates.current.get(story.id)
    if (pending) window.clearTimeout(pending.timer)
    const update = pendingAgentUpdate(pending, input, run, runInput)
    const timer = window.setTimeout(() => {
      pendingAgentUpdates.current.delete(story.id)
      void persistQueuedAgentUpdate(story, update).catch(() => undefined)
    }, agentEventPersistDelayMs)
    pendingAgentUpdates.current.set(story.id, { ...update, timer })
  }

  function flushAgentUpdate(
    story: UserStory,
    run: UserStoryAgentRun | undefined,
    input: UserStoryUpdate,
    runInput: UserStoryAgentRunUpdate
  ) {
    const pending = pendingAgentUpdates.current.get(story.id)
    if (pending) window.clearTimeout(pending.timer)
    pendingAgentUpdates.current.delete(story.id)
    const update = pendingAgentUpdate(pending, input, run, runInput)
    return persistTerminalAgentUpdate(
      window.localStorage,
      story,
      update,
      () => persistQueuedAgentUpdate(story, update)
    )
  }

  async function persistQueuedAgentUpdate(
    story: UserStory,
    update: QueuedAgentUpdate
  ) {
    let nextStory = activeStory(story, storiesRef.current)
    const metadata = agentMetadataUpdate(update.input)
    if (Object.keys(definedUpdate(metadata)).length) {
      nextStory = await backlog.update(
        activeStory(nextStory, storiesRef.current),
        metadata
      )
    }
    for (const activity of update.activities) {
      nextStory = await backlog.update(
        activeStory(nextStory, storiesRef.current),
        { agentActivity: activity }
      )
      if (update.run) {
        await backlog.updateAgentRun(nextStory, update.run, {
          agentActivity: activity,
        })
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
    auth.status,
    backlog.loading,
    backlog.projectId,
    backlog.stories,
    projects.activeProject,
    reportBlocker,
    startStory,
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
  setupScript: string
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
        story.status === "ready" &&
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
  if (!platform.workspace.runProjectSetup)
    return "Desktop setup runtime is not available."
  if (!platform.workspace.onSetupEvent)
    return "Desktop setup events are not available."
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
      Boolean(run.clineSessionId ?? story.clineSessionId)
  )
}

function nextAgentRun(story: UserStory, run: UserStoryAgentRun) {
  return story.agentRuns?.find(
    (candidate) =>
      candidate.id !== run.id &&
      Date.parse(candidate.createdAt) > Date.parse(run.createdAt)
  )
}

function activelyRunningStory(story: UserStory) {
  return story.status === "in-progress" && story.agentStatus === "Running"
}

function staleAgentRun(run: UserStoryAgentRun) {
  const updatedAt = run.updatedAt ?? run.createdAt
  return (
    Date.now() - new Date(updatedAt).getTime() >= agentCompletionRecoveryGraceMs
  )
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

function eventText(event: ProjectSetupEvent) {
  if (event.type === "exit") return `Setup exited with code ${event.data}`
  return event.data.trim()
}

function setupError(event: ProjectSetupEvent) {
  return (
    event.type === "stderr" || (event.type === "exit" && event.data !== "0")
  )
}

function setupCompleted(event: ProjectSetupEvent) {
  return event.type === "exit" && event.data === "0"
}

function setupFinished(event: ProjectSetupEvent) {
  return event.type === "exit"
}

function repairArtifacts(
  result: RepairProjectInitializationResult
): result is RepairProjectInitializationResult & {
  setupScript: string
  dockerCompose: string
} {
  return (
    result.classification === "repairable_initialization" &&
    Boolean(result.setupScript) &&
    Boolean(result.dockerCompose)
  )
}

function activePreviewStory(
  story: UserStory,
  setupInitializingStoryIds: Set<string>
) {
  return (
    (story.status === "in-progress" || story.status === "in-review") &&
    Boolean(story.worktree) &&
    !setupInitializingStoryIds.has(story.id)
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

function initializationRepairToast(story: UserStory) {
  return `${initializationRepairToastId}-${story.id}`
}
