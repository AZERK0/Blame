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
import {
  changedFilesFromDiff,
  completedStoryContextAttachment,
} from "@/components/backlog/data/user-story-context"
import { useBacklogStore } from "@/components/backlog/data/backlog-store"
import type {
  BacklogAction,
  BacklogColumnId,
  UserStory,
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryAgentRunUpdate,
  UserStoryCodeSelectionAttachment,
  UserStoryFileAttachment,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import { useModelSelection } from "@/components/model/model-selector"
import type { DrawerTarget } from "@/components/backlog/shared/backlog-types"
import { drawerTargetForAction } from "@/components/backlog/shared/backlog-helpers"
import { BacklogColumn } from "@/components/backlog/board/backlog-column"
import { BacklogToolbar } from "@/components/backlog/board/backlog-toolbar"
import { UserStoryDrawer } from "@/components/backlog/drawer/user-story-drawer"
import { HostDependenciesDialog } from "@/pages/backlog/host-dependencies-dialog"
import { useBacklogRotation } from "@/pages/backlog/use-backlog-rotation"
import { assessAndRepairProjectInitializationImpact } from "@/pages/backlog/project-initialization-impact"
import { useCloudAuth } from "@/context/cloud-auth"
import {
  usePlatform,
  type BacklogStatusPipRequest,
  type Platform,
} from "@/context/platform"
import { useProjects } from "@/context/projects"
import { projectCodePractices } from "@/lib/project-code-practices"
import {
  projectInitializing,
  useProjectInitialization,
} from "@/components/project-initialization/use-project-initialization"

const agentEventPersistDelayMs = 1_500
const reviewDiffRefreshDelayMs = 1_500

export function BacklogPage() {
  const backlog = useBacklogStore()
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const agentSelection = useModelSelection({ role: "agent" })
  const alternativeSelection = useModelSelection({ role: "alternative" })
  const rotation = useBacklogRotation(backlog)
  const [drawerTarget, setDrawerTarget] = React.useState<DrawerTarget>()
  const projectInitialization = useProjectInitialization()
  const initializationStatus = projectInitialization?.status ?? null
  const queueInitializing = projectInitializing(initializationStatus)
  const reviewDiffStates = useReviewDiffStates(
    backlog.stories,
    platform.workspace
  )
  const storiesRef = React.useRef(backlog.stories)
  const drawerLoadRequestId = React.useRef(0)
  const previousStoryStatuses = React.useRef<Map<string, BacklogColumnId>>()
  const pendingAgentUpdates = React.useRef(
    new Map<string, PendingAgentUpdate>()
  )

  React.useEffect(() => {
    storiesRef.current = backlog.stories
  }, [backlog.stories])

  React.useEffect(() => {
    notifyStoriesMovedToReview(
      backlog.stories,
      previousStoryStatuses.current,
      platform
    )
    previousStoryStatuses.current = storyStatusMap(backlog.stories)
  }, [backlog.stories, platform])

  React.useEffect(() => {
    platform.backlogStatusPip?.publish({
      authStatus: auth.status,
      hasActiveProject: Boolean(projects.activeProject),
      loading: backlog.loading,
      stories: backlog.stories,
    })
  }, [
    auth.status,
    backlog.loading,
    backlog.stories,
    platform.backlogStatusPip,
    projects.activeProject,
  ])

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
  const openDrawer = React.useCallback(
    (target: DrawerTarget) => {
      const requestId = ++drawerLoadRequestId.current
      setDrawerTarget(target)
      if (!target.userStory) {
        return
      }
      const currentStory = activeStory(target.userStory, storiesRef.current)
      if (backlog.storyDetailsLoaded(currentStory)) {
        setDrawerTarget({ ...target, userStory: currentStory })
        return
      }
      void backlog
        .loadDetail(currentStory)
        .then(() => {
          if (drawerLoadRequestId.current !== requestId) return
        })
        .catch((error) => {
          if (drawerLoadRequestId.current !== requestId) return
          toast.error("Unable to load user story details", {
            description: errorMessage(error),
            position: "bottom-right",
          })
        })
    },
    [backlog]
  )
  const openCreateDrawer = React.useCallback(() => {
    if (!backlog.projectPath) return
    drawerLoadRequestId.current += 1
    setDrawerTarget({
      mode: "create",
      initialTab: "user-story",
    })
  }, [backlog.projectPath])
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
  const updateStory = React.useCallback(
    async (
      story: UserStory,
      input: UserStoryUpdate,
      options: { cleanup?: boolean } = {}
    ) => {
      const currentStory = activeStory(story, storiesRef.current)
      const persistStoryUpdate = async (input: UserStoryUpdate) => {
        const nextStory = await backlog.update(currentStory, input)
        setDrawerTarget((current) =>
          current?.userStory?.id === currentStory.id
            ? { ...current, userStory: nextStory }
            : current
        )
        return nextStory
      }
      if (
        options.cleanup !== false &&
        asyncInactiveStoryCleanup(currentStory, input)
      ) {
        const nextStory = await persistStoryUpdate(input)
        void cleanupInactiveStory(
          currentStory,
          platform,
          projects.activeProject?.path,
          backlog
        )
        return nextStory
      }
      const cleanup =
        options.cleanup === false
          ? {}
          : await inactiveStoryCleanup(
              currentStory,
              input,
              platform,
              projects.activeProject?.path
            )
      return persistStoryUpdate({
        ...input,
        ...cleanup,
      })
    },
    [backlog, platform, projects.activeProject?.path]
  )
  const reviewDiffEmpty = React.useCallback(
    (story: UserStory) => reviewDiffStates.get(story.id) === "empty",
    [reviewDiffStates]
  )
  const persistQueuedAgentUpdate = React.useCallback(
    async (story: UserStory, update: QueuedAgentUpdate) => {
      let nextStory = activeStory(story, storiesRef.current)
      const metadata = agentMetadataUpdate(update.input)
      if (Object.keys(definedUpdate(metadata)).length) {
        nextStory = await updateStory(
          activeStory(nextStory, storiesRef.current),
          metadata,
          { cleanup: false }
        )
      }
      for (const activity of update.activities) {
        nextStory = await updateStory(
          activeStory(nextStory, storiesRef.current),
          { agentActivity: activity },
          { cleanup: false }
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
    },
    [backlog, updateStory]
  )
  const queueAgentUpdate = React.useCallback(
    (
      story: UserStory,
      run: UserStoryAgentRun | undefined,
      input: UserStoryUpdate,
      runInput: UserStoryAgentRunUpdate
    ) => {
      const pending = pendingAgentUpdates.current.get(story.id)
      if (pending) window.clearTimeout(pending.timer)
      const update = pendingAgentUpdate(pending, input, run, runInput)
      const timer = window.setTimeout(() => {
        pendingAgentUpdates.current.delete(story.id)
        void persistQueuedAgentUpdate(story, update).catch(() => undefined)
      }, agentEventPersistDelayMs)
      pendingAgentUpdates.current.set(story.id, { ...update, timer })
    },
    [persistQueuedAgentUpdate]
  )
  const flushAgentUpdate = React.useCallback(
    (
      story: UserStory,
      run: UserStoryAgentRun | undefined,
      input: UserStoryUpdate,
      runInput: UserStoryAgentRunUpdate
    ) => {
      const pending = pendingAgentUpdates.current.get(story.id)
      if (pending) window.clearTimeout(pending.timer)
      pendingAgentUpdates.current.delete(story.id)
      return persistQueuedAgentUpdate(
        story,
        pendingAgentUpdate(pending, input, run, runInput)
      )
    },
    [persistQueuedAgentUpdate]
  )
  const persistAgentUpdate = React.useCallback(
    (
      story: UserStory,
      run: UserStoryAgentRun | undefined,
      input: UserStoryUpdate,
      runInput: UserStoryAgentRunUpdate,
      immediate: boolean
    ) => {
      const nextStory = updateStoryLocal(story, input)
      if (run) backlog.updateAgentRunLocal(nextStory, run, runInput)
      if (immediate) {
        void flushAgentUpdate(nextStory, run, input, runInput).catch(
          reportAgentPersistenceError
        )
        return
      }
      queueAgentUpdate(nextStory, run, input, runInput)
    },
    [backlog, flushAgentUpdate, queueAgentUpdate, updateStoryLocal]
  )
  const persistAgentEvent = React.useCallback(
    (
      story: UserStory,
      run: UserStoryAgentRun | undefined,
      event: AgentEvent
    ) => {
      const currentStory = activeStory(story, storiesRef.current)
      const update = agentEventUpdate(currentStory, event)
      if (!shouldPersistAgentEvent(event, update)) return
      const text = agentEventText(event)
      const runInput = agentRunEventUpdate(update, event, text)
      persistAgentUpdate(
        currentStory,
        run,
        update,
        runInput,
        immediateAgentEvent(event)
      )
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
  const startStoryDevelopmentSession = React.useCallback(
    async (
      story: UserStory,
      input: {
        feedback?: string
        feedbackCodeSelectionAttachments?: UserStoryCodeSelectionAttachment[]
        feedbackFileAttachments?: UserStoryFileAttachment[]
        resumeSessionId?: string | null
        worktree: string
      }
    ) => {
      if (auth.status !== "authenticated")
        throw new Error("Reconnect the selected provider.")
      const agent = platform.agent
      if (!agent) throw new Error("Desktop agent runtime is not available.")
      const providerId =
        agentSelection.currentModel?.provider.id ?? story.agentProviderId
      const modelId = agentSelection.currentModel?.id ?? story.agentModelId
      if (!providerId || !modelId)
        throw new Error("Select a model before resuming this user story.")
      return agent.sessions.startDevelopment({
        apiConnection: auth.apiConnection,
        providerId,
        modelId,
        credentialLabel: agentSelection.currentModel?.credentialLabel,
        reasoningEffort: agentSelection.currentVariant,
        contextCompressionMode: agentSelection.contextCompressionMode,
        autoSendPrompt: false,
        title: story.title,
        summary: story.summary,
        codeSelectionAttachments: story.codeSelectionAttachments ?? [],
        fileAttachments: story.fileAttachments ?? [],
        feedback: input.feedback,
        feedbackCodeSelectionAttachments:
          input.feedbackCodeSelectionAttachments,
        feedbackFileAttachments: input.feedbackFileAttachments,
        resumeSessionId: input.resumeSessionId,
        cwd: input.worktree,
        workspaceRoot: input.worktree,
        codePractices: await projectCodePractices(auth, projects),
      })
    },
    [
      auth,
      agentSelection.contextCompressionMode,
      agentSelection.currentModel,
      agentSelection.currentVariant,
      platform.agent,
      projects,
    ]
  )
  const unpauseAgent = React.useCallback(
    async (story: UserStory) => {
      const currentStory = await detailedStory(story, backlog)
      if (!currentStory.worktree) {
        toast.error("Unable to resume agent", {
          description: "This user story has no active worktree.",
          position: "bottom-right",
        })
        return currentStory
      }
      if (auth.status !== "authenticated" || !agentSelection.currentModel) {
        toast.error("Unable to resume agent", {
          description: "Reconnect the provider and select a model.",
          position: "bottom-right",
        })
        return currentStory
      }
      const agent = platform.agent
      if (!agent) {
        toast.error("Unable to resume agent", {
          description: "Desktop agent runtime is not available.",
          position: "bottom-right",
        })
        return currentStory
      }
      const feedback = resumeAgentFeedback(
        currentStory,
        await currentDiffSummary(currentStory, platform)
      )
      const session = await startStoryDevelopmentSession(currentStory, {
        feedback,
        resumeSessionId: currentStory.clineSessionId,
        worktree: currentStory.worktree,
      })
      if (!session) {
        toast.error("Unable to resume agent", {
          description: "Desktop agent runtime is not available.",
          position: "bottom-right",
        })
        return currentStory
      }
      const run = await backlog.createAgentRun(currentStory, {
        clineSessionId: session.sessionId,
        kind: "resume",
      })
      const updatedStory = await updateStory(currentStory, {
        agentLastError: null,
        agentLastEvent: `Cline debug log: ${clineLogPath(currentStory.worktree, session.sessionId)}`,
        agentActivities: [],
        agentFinalResponse: null,
        agentUsage: null,
        agentModelId: agentSelection.currentModel.id,
        agentProviderId: agentSelection.currentModel.provider.id,
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
          persistAgentEvent(updatedStory, run, event)
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
        title: currentStory.title,
        summary: currentStory.summary,
        codeSelectionAttachments: currentStory.codeSelectionAttachments ?? [],
        fileAttachments: currentStory.fileAttachments ?? [],
        feedback,
      })
      return updatedStory
    },
    [
      auth,
      backlog,
      platform,
      agentSelection.currentModel,
      startStoryDevelopmentSession,
      updateStory,
      persistAgentEvent,
    ]
  )
  const requestChanges = React.useCallback(
    async (
      story: UserStory,
      feedback: string,
      commentId: string,
      codeSelectionAttachments:
        | UserStoryCodeSelectionAttachment[]
        | null
        | undefined,
      fileAttachments: UserStoryFileAttachment[] | null | undefined
    ) => {
      if (!story.worktree) {
        toast.error("Unable to request changes", {
          description: "This user story has no active worktree.",
          position: "bottom-right",
        })
        return story
      }
      if (!story.clineSessionId) {
        toast.error("Unable to request changes", {
          description: "This user story has no existing Cline session.",
          position: "bottom-right",
        })
        return story
      }
      const agent = platform.agent
      if (!agent) {
        toast.error("Unable to request changes", {
          description: "Desktop agent runtime is not available.",
          position: "bottom-right",
        })
        return story
      }
      let session: { sessionId: string }
      try {
        session = await startStoryDevelopmentSession(story, {
          feedback,
          feedbackCodeSelectionAttachments: codeSelectionAttachments ?? [],
          feedbackFileAttachments: fileAttachments ?? [],
          resumeSessionId: story.clineSessionId,
          worktree: story.worktree,
        })
      } catch (error) {
        toast.error("Unable to request changes", {
          description: errorMessage(error),
          position: "bottom-right",
        })
        return story
      }
      const sessionId = session.sessionId
      const run = await backlog.createAgentRun(story, {
        commentId,
        clineSessionId: sessionId,
        kind: "change-request",
      })
      const updatedStory = await updateStory(story, {
        agentLastError: null,
        agentLastEvent: `Cline debug log: ${clineLogPath(story.worktree, sessionId)}`,
        agentActivities: [],
        agentFinalResponse: null,
        agentUsage: null,
        agentStatus: "Running",
        clineSessionId: sessionId,
        status: "in-progress",
      })
      let authenticationFailed = false
      const unsubscribe = subscribeAgentEvents(platform, sessionId, (event) => {
        if (authenticationFailed) return
        authenticationFailed = expiredAuthenticationToken(agentEventText(event))
        persistAgentEvent(updatedStory, run, event)
        if (
          authenticationFailed ||
          event.type === "done" ||
          event.type === "error"
        )
          unsubscribe()
      })
      void agent.sessions.sendDevelopment({
        sessionId,
        title: story.title,
        summary: story.summary,
        feedback,
        feedbackOnly: true,
        feedbackCodeSelectionAttachments: codeSelectionAttachments ?? [],
        feedbackFileAttachments: fileAttachments ?? [],
      })
      return updatedStory
    },
    [
      backlog,
      platform,
      startStoryDevelopmentSession,
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
        alternativeSelection.currentModel
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
          providerId: alternativeSelection.currentModel!.provider.id,
          modelId: alternativeSelection.currentModel!.id,
          credentialLabel: alternativeSelection.currentModel!.credentialLabel,
          reasoningEffort: alternativeSelection.currentVariant,
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
            baseCommit: result.baseCommit,
            mergeCommit: result.mergeCommit,
            mergedAt: new Date().toISOString(),
            status: "done",
          },
          { cleanup: false }
        )
        void checkProjectInitializationImpact({
          auth,
          baseCommit: result.baseCommit,
          mergeCommit: result.mergeCommit,
          modelId: alternativeSelection.currentModel!.id,
          credentialLabel: alternativeSelection.currentModel!.credentialLabel,
          platform,
          projectId: projects.activeProject!.id,
          providerId: alternativeSelection.currentModel!.provider.id,
          reasoningEffort: alternativeSelection.currentVariant,
          repositoryRoot: projects.activeProject!.path,
        })
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
      alternativeSelection.currentModel,
      alternativeSelection.currentVariant,
      updateStory,
    ]
  )
  const markReviewStoryDone = React.useCallback(
    async (story: UserStory) => {
      const doneStory = await updateStory(story, {
        ...inactiveStoryFields(),
        agentLastError: null,
        agentLastEvent: "Marked as done.",
        status: "done",
      })
      toast.success("Story marked as done", {
        position: "bottom-right",
      })
      return doneStory
    },
    [updateStory]
  )
  const completeReviewStory = React.useCallback(
    async (story: UserStory) => {
      const emptyDiff = await currentReviewDiffEmpty(story, platform.workspace)
      if (emptyDiff) return markReviewStoryDone(story)
      return approveAndMergeStory(story)
    },
    [approveAndMergeStory, markReviewStoryDone, platform.workspace]
  )
  const optimizeUserStory = React.useCallback(
    (input: { summary: string; title: string }) =>
      optimizeUserStoryPrompt({
        input,
        auth,
        platform,
        projectPath: projects.activeProject?.path,
        model: alternativeSelection.currentModel,
        reasoningEffort: alternativeSelection.currentVariant,
      }),
    [
      auth,
      platform,
      projects.activeProject?.path,
      alternativeSelection.currentModel,
      alternativeSelection.currentVariant,
    ]
  )
  const runStoryAction = React.useCallback(
    async (story: UserStory, action: BacklogAction) => {
      const currentStory = await detailedStoryForAction(story, action, backlog)
      if (action === "Send to Dev Agent") {
        return updateStory(currentStory, { status: "ready" })
      }
      if (action === "Discard") {
        return updateStory(currentStory, {
          discardedReason: "Discarded from backlog",
          status: "discarded",
        })
      }
      if (action === "Dequeue")
        return updateStory(currentStory, { status: "backlog" })
      if (action === "Rework") {
        return updateStory(currentStory, {
          discardedReason: null,
          status: "backlog",
        })
      }
      if (action === "Use Context") {
        const changedFiles = await completedStoryChangedFiles(
          currentStory,
          platform,
          projects.activeProject?.path
        )
        drawerLoadRequestId.current += 1
        setDrawerTarget({
          initialDraft: {
            fileAttachments: [
              completedStoryContextAttachment(currentStory, changedFiles),
            ],
          },
          initialTab: "user-story",
          mode: "create",
        })
        return
      }
      if (action === "Approve & Merge") return completeReviewStory(currentStory)
    },
    [
      completeReviewStory,
      backlog,
      platform,
      projects.activeProject?.path,
      updateStory,
    ]
  )
  const runStatusPipRequest = React.useCallback(
    (request: BacklogStatusPipRequest) => {
      const story = storiesRef.current.find(
        (story) => story.id === request.storyId
      )
      if (!story) return
      const currentStory = activeStory(story, storiesRef.current)

      if (request.drawer) {
        openDrawer(statusPipDrawerTarget(currentStory, request))
        return
      }
      if (request.rejectChoice) {
        void rejectStory(currentStory, request.rejectChoice).catch(
          reportStatusPipRequestError
        )
        return
      }
      if (request.stopChoice) {
        void stopAgent(currentStory, request.stopChoice).catch(
          reportStatusPipRequestError
        )
        return
      }
      if (!request.action) return
      if (request.action === "Open Worktree") {
        void openWorktree(currentStory).catch(reportStatusPipRequestError)
        return
      }
      if (request.action === "Unpause Agent") {
        void unpauseAgent(currentStory).catch(reportStatusPipRequestError)
        return
      }
      if (
        request.action === "Open Preview" ||
        request.action === "View Diff" ||
        request.action === "View Files" ||
        request.action === "View Terminal" ||
        request.action === "Request Changes"
      ) {
        openDrawer(drawerTargetForAction(currentStory, request.action))
        return
      }
      void runStoryAction(currentStory, request.action).catch(
        reportStatusPipRequestError
      )
    },
    [
      openDrawer,
      openWorktree,
      rejectStory,
      runStoryAction,
      stopAgent,
      unpauseAgent,
    ]
  )
  React.useEffect(() => {
    return platform.backlogStatusPip?.onRequest(runStatusPipRequest)
  }, [platform.backlogStatusPip, runStatusPipRequest])
  const openStatusPip = React.useCallback(() => {
    void platform.backlogStatusPip?.open().catch((error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to open status picture in picture."
      )
    })
  }, [platform.backlogStatusPip])

  return (
    <div className="flex h-[calc(100svh_-_var(--header-height))] min-h-0 min-w-0 flex-col gap-4 overflow-hidden p-4 md:h-[calc(100svh_-_var(--header-height)_-_1rem)] lg:p-6">
      <BacklogToolbar
        disabled={!backlog.projectPath}
        onOpenStatusPip={platform.backlogStatusPip ? openStatusPip : undefined}
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
      <div className="-mx-6 min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden px-6">
        <div className="grid h-full min-w-500 auto-rows-[minmax(0,1fr)] grid-cols-6 gap-3 pb-3">
          {backlogColumns.map((column) => (
            <BacklogColumn
              key={column.id}
              column={column}
              onAction={runStoryAction}
              onCreateUserStory={openCreateDrawer}
              onDeleteUserStory={backlog.remove}
              onOpenDrawer={openDrawer}
              onOpenWorktree={openWorktree}
              onReject={rejectStory}
              reviewDiffEmpty={reviewDiffEmpty}
              onStopAgent={stopAgent}
              onUnpauseAgent={unpauseAgent}
              queueInitializing={column.id === "ready" && queueInitializing}
              storyCleanup={backlog.storyCleanup}
              storySetupInitializing={backlog.storySetupInitializing}
              stories={backlog.storiesForColumn(column.id)}
            />
          ))}
        </div>
      </div>
      <UserStoryDrawer
        open={Boolean(drawerTarget)}
        onOpenChange={(open) => {
          if (!open) {
            drawerLoadRequestId.current += 1
            setDrawerTarget(undefined)
          }
        }}
        userStory={drawerUserStory}
        mode={drawerTarget?.mode ?? "view"}
        initialDraft={drawerTarget?.initialDraft}
        initialTab={drawerTarget?.initialTab}
        initialDevelopmentTab={drawerTarget?.initialDevelopmentTab}
        focusComment={drawerTarget?.focusComment}
        onCreateUserStory={async (input) => {
          const story = await backlog.create(input)
          setDrawerTarget({ userStory: story, mode: "edit" })
          return story
        }}
        onCreateUserStoryComment={(story, input) =>
          backlog.createComment(story, input)
        }
        onDeleteUserStory={(story) => backlog.remove(story)}
        onUpdateUserStory={async (story, input) => {
          return updateStory(story, input)
        }}
        onOpenDrawer={openDrawer}
        onOptimizeUserStory={optimizeUserStory}
        onApproveAndMerge={completeReviewStory}
        onRequestChanges={requestChanges}
        onReject={rejectStory}
        reviewDiffEmpty={
          drawerUserStory ? reviewDiffEmpty(drawerUserStory) : false
        }
        onStopAgent={stopAgent}
        setupInitializing={backlog.storySetupInitializing(drawerUserStory)}
      />
      <HostDependenciesDialog {...rotation.hostDependenciesDialog} />
    </div>
  )
}

type ReviewDiffState = "changed" | "empty"
type ReviewDiffStory = Pick<UserStory, "id"> & { worktree: string }
type ReviewDiffResult = {
  id: string
  state?: ReviewDiffState
}
type ReviewDiffStateSetter = React.Dispatch<
  React.SetStateAction<Map<string, ReviewDiffState>>
>

function useReviewDiffStates(
  stories: UserStory[],
  workspace: Platform["workspace"]
) {
  const [states, setStates] = React.useState(
    () => new Map<string, ReviewDiffState>()
  )

  React.useEffect(() => {
    return subscribeReviewDiffStates(stories, workspace, setStates)
  }, [stories, workspace])

  return states
}

function subscribeReviewDiffStates(
  stories: UserStory[],
  workspace: Platform["workspace"],
  setStates: ReviewDiffStateSetter
) {
  let cancelled = false
  const loadStates = () =>
    loadReviewDiffStates(stories, workspace, setStates, () => cancelled)
  loadStates()
  const timer = setInterval(() => {
    if (document.visibilityState === "visible") loadStates()
  }, reviewDiffRefreshDelayMs)
  return () => {
    cancelled = true
    clearInterval(timer)
  }
}

function loadReviewDiffStates(
  stories: UserStory[],
  workspace: Platform["workspace"],
  setStates: ReviewDiffStateSetter,
  cancelled: () => boolean
) {
  const reviewStories = reviewDiffStories(stories)
  if (!workspace || !reviewStories.length) {
    setStates((current) => pruneReviewDiffStates(current, reviewStories))
    return
  }
  void Promise.all(
    reviewStories.map((story) => loadReviewDiffState(story, workspace))
  ).then((results) => {
    if (cancelled()) return
    setStates((current) =>
      mergeReviewDiffStates(current, reviewStories, results)
    )
  })
}

function reviewDiffStories(stories: UserStory[]): ReviewDiffStory[] {
  return stories.flatMap((story) =>
    story.status === "in-review" && story.worktree
      ? [{ id: story.id, worktree: story.worktree }]
      : []
  )
}

async function loadReviewDiffState(
  story: ReviewDiffStory,
  workspace: NonNullable<Platform["workspace"]>
): Promise<ReviewDiffResult> {
  try {
    const diff = await workspace.gitDiff({ root: story.worktree })
    const state = changedFilesFromDiff(diff).length ? "changed" : "empty"
    return { id: story.id, state }
  } catch {
    return { id: story.id }
  }
}

function mergeReviewDiffStates(
  current: Map<string, ReviewDiffState>,
  stories: ReviewDiffStory[],
  results: ReviewDiffResult[]
) {
  const next = retainedReviewDiffStates(current, stories)
  for (const result of results) {
    if (result.state) next.set(result.id, result.state)
    else next.delete(result.id)
  }
  return sameReviewDiffStates(current, next) ? current : next
}

function pruneReviewDiffStates(
  current: Map<string, ReviewDiffState>,
  stories: ReviewDiffStory[]
) {
  const next = retainedReviewDiffStates(current, stories)
  return sameReviewDiffStates(current, next) ? current : next
}

function retainedReviewDiffStates(
  current: Map<string, ReviewDiffState>,
  stories: ReviewDiffStory[]
) {
  const storyIds = new Set(stories.map((story) => story.id))
  return new Map([...current].filter(([id]) => storyIds.has(id)))
}

function sameReviewDiffStates(
  current: Map<string, ReviewDiffState>,
  next: Map<string, ReviewDiffState>
) {
  if (current.size !== next.size) return false
  return [...current].every(([id, state]) => next.get(id) === state)
}

async function currentReviewDiffEmpty(
  story: UserStory,
  workspace: Platform["workspace"]
) {
  if (!story.worktree || !workspace) return false
  try {
    const diff = await workspace.gitDiff({ root: story.worktree })
    return changedFilesFromDiff(diff).length === 0
  } catch {
    return false
  }
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

function optimizeUserStoryValidationError(
  summary: string,
  auth: ReturnType<typeof useCloudAuth>,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined,
  model: unknown
) {
  if (!summary.trim()) return "Write a user story before optimizing it."
  if (!repositoryRoot) return "Unable to resolve the active project."
  if (auth.status !== "authenticated")
    return "Reconnect the provider before optimizing the user story."
  if (!model) return "Select a model before optimizing the user story."
  if (!platform.agent?.promptOptimizer)
    return "Desktop agent runtime is not available."
}

type OptimizeUserStoryPromptRequest = {
  input: {
    summary: string
    title: string
  }
  auth: ReturnType<typeof useCloudAuth>
  platform: ReturnType<typeof usePlatform>
  projectPath?: string
  model: ReturnType<typeof useModelSelection>["currentModel"]
  reasoningEffort: ReturnType<typeof useModelSelection>["currentVariant"]
}

async function optimizeUserStoryPrompt(
  request: OptimizeUserStoryPromptRequest
) {
  const validationError = optimizeUserStoryValidationError(
    request.input.summary,
    request.auth,
    request.platform,
    request.projectPath,
    request.model
  )
  if (validationError) throw optimizationValidationError(validationError)
  const toastId = "user-story-prompt-optimizer"
  toast.loading("Optimizing user story", {
    id: toastId,
    position: "bottom-right",
  })
  try {
    const result = await runPromptOptimizer(request)
    toast.success("User story optimized", {
      id: toastId,
      position: "bottom-right",
    })
    return result
  } catch (error) {
    toast.error("User story optimization failed", {
      description: errorMessage(error),
      id: toastId,
      position: "bottom-right",
    })
    throw error
  }
}

function optimizationValidationError(message: string) {
  toast.error("Unable to optimize user story", {
    description: message,
    position: "bottom-right",
  })
  return new Error(message)
}

async function runPromptOptimizer(request: OptimizeUserStoryPromptRequest) {
  const result =
    await request.platform.agent!.promptOptimizer.optimizeUserStory({
      apiConnection: request.auth.apiConnection,
      providerId: request.model!.provider.id,
      modelId: request.model!.id,
      credentialLabel: request.model!.credentialLabel,
      reasoningEffort: request.reasoningEffort,
      prompt: request.input.summary,
      title: request.input.title,
      cwd: request.projectPath!,
      workspaceRoot: request.projectPath!,
    })
  return result.markdown
}

type CheckInitializationImpactInput = {
  auth: ReturnType<typeof useCloudAuth>
  platform: ReturnType<typeof usePlatform>
  projectId: string
  providerId: string
  modelId: string
  credentialLabel?: string
  reasoningEffort?: "low" | "medium" | "high" | "xhigh"
  repositoryRoot: string
  baseCommit: string
  mergeCommit: string
}

async function checkProjectInitializationImpact(
  input: CheckInitializationImpactInput
) {
  const toastId = `project-initialization-impact-${input.mergeCommit}`
  toast.loading("Checking initialization impact", {
    id: toastId,
    position: "bottom-right",
  })
  try {
    const result = await assessAndRepairProjectInitializationImpact({
      apiConnection: input.auth.apiConnection,
      platform: input.platform,
      projectId: input.projectId,
      providerId: input.providerId,
      modelId: input.modelId,
      credentialLabel: input.credentialLabel,
      reasoningEffort: input.reasoningEffort,
      repositoryRoot: input.repositoryRoot,
      baseCommit: input.baseCommit,
      mergeCommit: input.mergeCommit,
    })
    showInitializationImpactResult(toastId, result)
  } catch (error) {
    toast.error("Story merged, initialization check failed", {
      description: errorMessage(error),
      id: toastId,
      position: "bottom-right",
    })
  }
}

function showInitializationImpactResult(
  toastId: string,
  result:
    | Awaited<ReturnType<typeof assessAndRepairProjectInitializationImpact>>
    | undefined
) {
  if (!result) {
    toast.dismiss(toastId)
    return
  }
  if (result.repair?.classification === "repairable_initialization") {
    toast.success("Initialization artifacts updated", {
      description: result.repair.reason,
      id: toastId,
      position: "bottom-right",
    })
    return
  }
  if (result.assessment.classification === "initialization_update_required") {
    toast.error("Story merged, initialization update failed", {
      description: result.repair?.reason ?? result.assessment.reason,
      id: toastId,
      position: "bottom-right",
    })
    return
  }
  toast.dismiss(toastId)
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

function asyncInactiveStoryCleanup(story: UserStory, input: UserStoryUpdate) {
  const nextStatus = input.status ?? story.status
  return (
    nextStatus === "discarded" && leavesRuntimeStatus(story.status, nextStatus)
  )
}

async function cleanupInactiveStory(
  story: UserStory,
  platform: ReturnType<typeof usePlatform>,
  repositoryRoot: string | undefined,
  backlog: ReturnType<typeof useBacklogStore>
) {
  backlog.setStoryCleanup(story, true)
  try {
    await stopStoryRuntime(story, platform)
    await removeStoryWorktree(story, platform, repositoryRoot)
    await backlog.update(story, inactiveStoryFields())
  } catch (error) {
    toast.error("Discarded story cleanup failed", {
      description: errorMessage(error),
      position: "bottom-right",
    })
  } finally {
    backlog.setStoryCleanup(story, false)
  }
}

const runtimeStatuses = new Set<BacklogColumnId>(["in-progress", "in-review"])

function leavesRuntimeStatus(
  currentStatus: BacklogColumnId,
  nextStatus: BacklogColumnId
) {
  return runtimeStatuses.has(currentStatus) && !runtimeStatuses.has(nextStatus)
}

function notifyStoriesMovedToReview(
  stories: UserStory[],
  previousStatuses: Map<string, BacklogColumnId> | undefined,
  platform: ReturnType<typeof usePlatform>
) {
  if (!previousStatuses) return
  for (const story of stories) {
    const previousStatus = previousStatuses.get(story.id)
    if (previousStatus === undefined || previousStatus === "in-review") continue
    if (story.status !== "in-review") continue
    void platform.systemNotifications
      ?.show({
        body: story.title,
        title: "User story ready for review",
      })
      .catch(() => false)
  }
}

function storyStatusMap(stories: UserStory[]) {
  return new Map(stories.map((story) => [story.id, story.status]))
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

function detailedStory(
  story: UserStory,
  backlog: ReturnType<typeof useBacklogStore>
) {
  if (backlog.storyDetailsLoaded(story)) return Promise.resolve(story)
  return backlog.loadDetail(story)
}

function detailedStoryForAction(
  story: UserStory,
  action: BacklogAction,
  backlog: ReturnType<typeof useBacklogStore>
) {
  if (!storyActionRequiresDetail(action)) return Promise.resolve(story)
  return detailedStory(story, backlog)
}

function storyActionRequiresDetail(action: BacklogAction) {
  return action === "Approve & Merge" || action === "Use Context"
}

function statusPipDrawerTarget(
  story: UserStory,
  request: BacklogStatusPipRequest
): DrawerTarget {
  return {
    userStory: story,
    mode:
      story.status === "backlog" || story.status === "discarded"
        ? "edit"
        : "view",
    focusComment: request.drawer?.focusComment,
    initialDevelopmentTab: request.drawer?.initialDevelopmentTab,
    initialTab: request.drawer?.initialTab ?? "user-story",
  }
}

function reportAgentPersistenceError(error: unknown) {
  console.error("Failed to persist agent update.", error)
}

function reportStatusPipRequestError(error: unknown) {
  toast.error("Unable to run picture in picture action", {
    description:
      error instanceof Error ? error.message : "An unexpected error occurred.",
    position: "bottom-right",
  })
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
  input: UserStoryUpdate,
  event: AgentEvent,
  text: string
): UserStoryAgentRunUpdate {
  const update: UserStoryAgentRunUpdate = {}
  if (input.agentActivity) update.agentActivity = input.agentActivity
  if (input.agentActivityUpdates)
    update.agentActivityUpdates = input.agentActivityUpdates
  if (input.agentFinalResponse !== undefined)
    update.finalResponse = input.agentFinalResponse
  if (input.agentUsage !== undefined) update.usage = input.agentUsage
  if (input.agentSessionSummary !== undefined)
    update.sessionSummary = input.agentSessionSummary
  if (completedAgentRun(event)) {
    update.status = "completed"
    update.completedAt = new Date().toISOString()
  } else if (failedAgentRun(event)) {
    update.status = "failed"
    update.completedAt = new Date().toISOString()
    if (!update.finalResponse && text) update.finalResponse = text
  }
  return update
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
  if (failedAgentRun(event)) {
    return {
      ...flowUpdate,
      agentLastError: text || "Agent session failed",
      agentLastEvent: text || "Agent session failed",
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

function failedAgentRun(event: AgentEvent) {
  return (
    event.type === "error" ||
    (event.type === "done" && !completedAgentRun(event))
  )
}

function resumeAgentFeedback(story: UserStory, diffSummary: string) {
  const details = [
    story.agentSessionSummary
      ? `Previous session summary:\n${story.agentSessionSummary}`
      : "",
    story.agentLastError ? `Previous agent error: ${story.agentLastError}` : "",
    story.agentLastEvent ? `Last recorded event: ${story.agentLastEvent}` : "",
    diffSummary,
  ].filter(Boolean)
  return [
    "Resume the implementation from the existing worktree.",
    "Inspect the current git diff first, keep the useful existing changes, and continue until the story is ready for review.",
    ...details,
  ].join("\n")
}

async function currentDiffSummary(story: UserStory, platform: Platform) {
  if (!story.worktree || !platform.workspace) return ""
  try {
    const diff = await platform.workspace.gitDiff({ root: story.worktree })
    return diffSummary(diff)
  } catch {
    return ""
  }
}

function diffSummary(diff: string) {
  const files = Array.from(diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm))
    .map((match) => match[2])
    .filter(Boolean)
    .slice(0, 20)
  if (files.length === 0) return "Current git diff: no local changes."
  return `Current git diff files: ${files.join(", ")}.`
}

async function completedStoryChangedFiles(
  story: UserStory,
  platform: Platform,
  repositoryRoot: string | undefined
) {
  if (!repositoryRoot || !platform.workspace || !story.mergeCommit) return []
  try {
    const diff = await platform.workspace.gitDiffBetween({
      from: story.baseCommit ?? `${story.mergeCommit}^`,
      root: repositoryRoot,
      to: story.mergeCommit,
    })
    return changedFilesFromDiff(diff)
  } catch {
    return []
  }
}
