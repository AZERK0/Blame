import * as React from "react"
import type { AgentEvent } from "@blame/agent-runtime"
import { SendIcon } from "lucide-react"
import { toast } from "sonner"

import type { Platform } from "@/context/platform"
import type { UserStoryFileAttachment } from "@/components/backlog/data/backlog-data"
import {
  agentEventText,
  completedAgentRun,
  shouldPersistAgentEvent,
} from "@/components/backlog/data/agent-flow"
import { subscribeAgentEvents } from "@/components/backlog/data/agent-event-stream"
import {
  codeSelectionAttachmentEvent,
  type CodeSelectionAttachment,
  type PendingCodeSelectionAttachment,
} from "@/components/backlog/shared/comment-attachment-events"
import { pendingFileAttachments } from "@/components/backlog/drawer/user-story-attachment-files"
import {
  projectPreviewConfiguration,
  projectRunConfigurationPreviewKey,
} from "@/components/backlog/board/project-run-configuration"
import { ProjectRunConfigurationPreviewWarmup } from "@/components/backlog/board/project-run-preview-warmup"
import {
  AgentConversationComposer,
  AgentConversationTimeline,
  type AgentConversationUserMessageUndo,
} from "@/components/chat/agent-conversation"
import {
  clearPendingQuickChatAgentUpdates,
  completedQuickChatClineLog,
  definedQuickChatUpdate,
  immediateQuickChatAgentEvent,
  pendingQuickChatAgentUpdate,
  quickChatAgentEventUpdate,
  quickChatAgentMetadataUpdate,
  quickChatAgentRunEventUpdate,
  quickChatAgentRunMetadataUpdate,
  quickChatClineLogPath,
  quickChatClineLogRelativePath,
  quickChatExpiredAuthenticationToken,
  recoverableQuickChatAgentRun,
  type PendingQuickChatAgentUpdate,
  type QueuedQuickChatAgentUpdate,
} from "@/components/chat/data/quick-chat-agent-flow"
import {
  type QuickChat,
  type QuickChatAgentRun,
  type QuickChatAgentRunUpdate,
  type QuickChatMessage,
  type QuickChatUpdate,
} from "@/components/chat/data/quick-chat-data"
import { useQuickChatStore } from "@/components/chat/data/quick-chat-store"
import { agentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import {
  composerDraftStorageKey,
  readComposerDraft,
  removeComposerDraft,
  writeComposerDraft,
} from "@/components/backlog/drawer/composer-draft-storage"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { useProjectInitialization } from "@/components/project-initialization/use-project-initialization"
import { projectCodePractices } from "@/lib/project-code-practices"
import { showSystemNotification } from "@/lib/system-notifications"
import { generateAgentTitle } from "@/lib/agent-title-generation"

const agentEventPersistDelayMs = 1_500
const agentCompletionRecoveryIntervalMs = 10_000
const stoppedAgentEvent = {
  payload: { reason: "aborted", text: "Agent stopped." },
  type: "done",
} satisfies AgentEvent
const bottomBlurMask = {
  maskImage: "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
} satisfies React.CSSProperties

type QuickChatDevelopmentSessionInput = {
  codeAttachments: PendingCodeSelectionAttachment[]
  executionId: string
  fileAttachments: UserStoryFileAttachment[]
  resumeSessionId?: string | null
  summary: string
  title: string
  workspace: string
}

type QuickChatPromptInput = {
  chat: QuickChat
  codeAttachments: PendingCodeSelectionAttachment[]
  executionId: string
  fileAttachments: UserStoryFileAttachment[]
  message: QuickChatMessage
  run: QuickChatAgentRun
  reusedSession: boolean
  sessionId: string
  summary: string
  title: string
}

export function ChatPage() {
  const projects = useProjects()
  const projectKey = projects.activeProject?.id ?? "project"

  return <QuickChatProjectPage key={projectKey} />
}

function QuickChatProjectPage() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const projects = useProjects()
  const projectInitialization = useProjectInitialization()
  const quickChats = useQuickChatStore()
  const selection = useModelSelection({ role: "agent" })
  const project = projects.activeProject
  const previewConfiguration = projectPreviewConfiguration(
    projectInitialization?.initialization?.runConfigurations ?? []
  )
  const [draft, setDraft] = React.useState("")
  const [draftEditorKey, setDraftEditorKey] = React.useState(0)
  const [draftCodeAttachments, setDraftCodeAttachments] = React.useState<
    PendingCodeSelectionAttachment[]
  >([])
  const [draftFileAttachments, setDraftFileAttachments] = React.useState<
    UserStoryFileAttachment[]
  >([])
  const [sending, setSending] = React.useState(false)
  const [cancelingAgent, setCancelingAgent] = React.useState(false)
  const chatsRef = React.useRef(quickChats.chats)
  const pendingAgentUpdates = React.useRef(
    new Map<string, PendingQuickChatAgentUpdate>()
  )
  const agentEventUnsubscribers = React.useRef(
    new Map<string, () => void>()
  )
  const recoveringAgentRunIds = React.useRef(new Set<string>())
  const recoverAgentEventRef = React.useRef<
    (
      chat: QuickChat,
      run: QuickChatAgentRun | undefined,
      event: AgentEvent
    ) => Promise<QuickChat | void>
  >(() => Promise.resolve())
  const draftRef = React.useRef<HTMLDivElement>(null)
  const activeConversation = quickChats.activeChat
  const draftStorageKey = composerDraftStorageKey(
    project?.id ?? "project",
    "chat",
    activeConversation?.id
  )
  const loadedDraftStorageKeyRef = React.useRef<string>()
  const activeConversationLoaded =
    !activeConversation || quickChats.chatDetailsLoaded(activeConversation)
  const responseHeader = agentConversationResponseHeader({
    modelId: activeConversation?.agentModelId ?? selection.currentModel?.id,
    providerId:
      activeConversation?.agentProviderId ??
      selection.currentModel?.provider.id,
    providers: selection.allProviders,
  })
  const mentionDirectory = project?.path
  const agentRunning = activeConversation?.agentStatus === "Running"
  React.useEffect(() => {
    chatsRef.current = quickChats.chats
  }, [quickChats.chats])

  React.useEffect(() => {
    if (!activeConversation || quickChats.chatDetailsLoaded(activeConversation))
      return
    void quickChats.loadDetail(activeConversation).catch((error) => {
      showQuickChatError("Unable to load quick chat", errorMessage(error))
    })
  }, [activeConversation, quickChats])

  React.useEffect(() => {
    const updates = pendingAgentUpdates.current
    const unsubscribers = agentEventUnsubscribers.current
    return () => {
      clearPendingQuickChatAgentUpdates(updates)
      unsubscribers.forEach((unsubscribe) => unsubscribe())
      unsubscribers.clear()
    }
  }, [])

  React.useEffect(() => {
    if (!platform.workspace || !activeConversationLoaded || !activeConversation)
      return
    const recover = async () => {
      const current = currentChat(activeConversation)
      const run = recoverableQuickChatAgentRun(current)
      const workspace = platform.workspace
      const sessionId = run?.clineSessionId ?? current.clineSessionId
      if (!run || !workspace || !current.workspace || !sessionId) return
      if (recoveringAgentRunIds.current.has(run.id)) return
      recoveringAgentRunIds.current.add(run.id)
      try {
        const log = await workspace
          .readFile({
            root: current.workspace,
            path: quickChatClineLogRelativePath(sessionId),
          })
          .catch(() => "")
        if (!completedQuickChatClineLog(log)) return
        await recoverAgentEventRef.current(currentChat(current), run, {
          payload: {},
          type: "done",
        })
      } finally {
        recoveringAgentRunIds.current.delete(run.id)
      }
    }
    void recover()
    const timer = window.setInterval(recover, agentCompletionRecoveryIntervalMs)
    return () => window.clearInterval(timer)
  }, [activeConversation, activeConversationLoaded, platform.workspace])

  React.useEffect(() => {
    if (loadedDraftStorageKeyRef.current !== draftStorageKey) {
      loadedDraftStorageKeyRef.current = draftStorageKey
      const storedDraft = readComposerDraft(localStorage, draftStorageKey)
      setDraft(storedDraft?.markdown ?? "")
      setDraftCodeAttachments(storedDraft?.codeSelectionAttachments ?? [])
      setDraftFileAttachments(storedDraft?.fileAttachments ?? [])
      setDraftEditorKey((key) => key + 1)
      return
    }
    writeComposerDraft(localStorage, draftStorageKey, {
      markdown: draft,
      codeSelectionAttachments: draftCodeAttachments,
      fileAttachments: draftFileAttachments,
    })
  }, [draft, draftCodeAttachments, draftFileAttachments, draftStorageKey])

  React.useEffect(() => {
    const addAttachment = (event: Event) => {
      setDraftCodeAttachments((current) => [
        ...current,
        {
          ...(event as CustomEvent<CodeSelectionAttachment>).detail,
          id: crypto.randomUUID(),
        },
      ])
      requestAnimationFrame(() => {
        draftRef.current
          ?.querySelector<HTMLElement>("[data-markdown-editor-input='true']")
          ?.focus()
      })
    }
    window.addEventListener(codeSelectionAttachmentEvent, addAttachment)
    return () =>
      window.removeEventListener(codeSelectionAttachmentEvent, addAttachment)
  }, [])

  function replaceChatRef(chat: QuickChat) {
    const exists = chatsRef.current.some((item) => item.id === chat.id)
    chatsRef.current = exists
      ? chatsRef.current.map((item) => (item.id === chat.id ? chat : item))
      : [chat, ...chatsRef.current]
  }

  function currentChat(chat: QuickChat) {
    return chatsRef.current.find((item) => item.id === chat.id) ?? chat
  }

  function updateChatLocal(chat: QuickChat, input: QuickChatUpdate) {
    const current = currentChat(chat)
    const next = { ...current, ...definedQuickChatUpdate(input) } as QuickChat
    replaceChatRef(next)
    quickChats.updateLocal(current, input)
    return next
  }

  async function persistQueuedAgentUpdate(
    chat: QuickChat,
    update: QueuedQuickChatAgentUpdate
  ) {
    let nextChat = currentChat(chat)
    const metadata = quickChatAgentMetadataUpdate(update.input)
    if (Object.keys(definedQuickChatUpdate(metadata)).length) {
      nextChat = await quickChats.update(nextChat, metadata)
      replaceChatRef(nextChat)
    }
    for (const activity of update.activities) {
      nextChat = await quickChats.update(currentChat(nextChat), {
        agentActivity: activity,
      })
      replaceChatRef(nextChat)
      if (update.run) {
        await quickChats.updateAgentRun(nextChat, update.run, {
          agentActivity: activity,
        })
      }
    }
    if (update.run) await persistAgentRunMetadata(nextChat, update)
    return nextChat
  }

  async function persistAgentRunMetadata(
    chat: QuickChat,
    update: QueuedQuickChatAgentUpdate
  ) {
    if (!update.run) return
    const metadata = quickChatAgentRunMetadataUpdate(update.runInput)
    if (!Object.keys(definedQuickChatUpdate(metadata)).length) return
    await quickChats.updateAgentRun(chat, update.run, metadata)
  }

  function queueAgentUpdate(
    chat: QuickChat,
    run: QuickChatAgentRun | undefined,
    input: QuickChatUpdate,
    runInput: QuickChatAgentRunUpdate
  ) {
    const pending = pendingAgentUpdates.current.get(chat.id)
    if (pending) window.clearTimeout(pending.timer)
    const update = pendingQuickChatAgentUpdate(pending, input, run, runInput)
    const timer = window.setTimeout(() => {
      pendingAgentUpdates.current.delete(chat.id)
      void persistQueuedAgentUpdate(chat, update).catch(
        reportAgentPersistenceError
      )
    }, agentEventPersistDelayMs)
    pendingAgentUpdates.current.set(chat.id, { ...update, timer })
  }

  function flushAgentUpdate(
    chat: QuickChat,
    run: QuickChatAgentRun | undefined,
    input: QuickChatUpdate,
    runInput: QuickChatAgentRunUpdate
  ) {
    const pending = pendingAgentUpdates.current.get(chat.id)
    if (pending) window.clearTimeout(pending.timer)
    pendingAgentUpdates.current.delete(chat.id)
    return persistQueuedAgentUpdate(
      chat,
      pendingQuickChatAgentUpdate(pending, input, run, runInput)
    )
  }

  function persistAgentUpdate(
    chat: QuickChat,
    run: QuickChatAgentRun | undefined,
    input: QuickChatUpdate,
    runInput: QuickChatAgentRunUpdate,
    immediate: boolean
  ) {
    const nextChat = updateChatLocal(chat, input)
    if (run) quickChats.updateAgentRunLocal(nextChat, run, runInput)
    if (immediate) {
      return flushAgentUpdate(nextChat, run, input, runInput).catch((error) => {
        reportAgentPersistenceError(error)
        throw error
      })
    }
    queueAgentUpdate(nextChat, run, input, runInput)
    return Promise.resolve(nextChat)
  }

  function persistAgentEvent(
    chat: QuickChat,
    run: QuickChatAgentRun | undefined,
    event: AgentEvent
  ) {
    const current = currentChat(chat)
    const update = quickChatAgentEventUpdate(current, event)
    if (!shouldPersistAgentEvent(event, update)) return
    const text = agentEventText(event)
    const runInput = quickChatAgentRunEventUpdate(update, event, text)
    if (completedAgentRun(event)) notifyQuickChatResponseCompleted(current)
    return persistAgentUpdate(
      current,
      run,
      update,
      runInput,
      immediateQuickChatAgentEvent(event)
    )
  }

  React.useEffect(() => {
    recoverAgentEventRef.current = persistAgentEvent
  })

  function notifyQuickChatResponseCompleted(chat: QuickChat) {
    void showSystemNotification(platform, {
      body: chat.title,
      title: "Agent response ready",
    })
  }

  async function undoQuickChatMessage(
    target: AgentConversationUserMessageUndo
  ) {
    if (!activeConversation) return
    const current = await detailedConversation(activeConversation)
    const restored = await restoreQuickChatCheckpoint(
      platform,
      current,
      target.run.clineSessionId ?? current.clineSessionId,
      target.checkpointRunCount
    )
    const nextConversation = await quickChats.undoMessage(
      current,
      target.comment.id,
      { clineSessionId: restored.sessionId }
    )
    replaceChatRef(nextConversation)
    setDraft(target.comment.body)
    setDraftCodeAttachments(target.comment.codeSelectionAttachments ?? [])
    setDraftFileAttachments(target.comment.fileAttachments ?? [])
    setDraftEditorKey((key) => key + 1)
    requestAnimationFrame(() => {
      draftRef.current
        ?.querySelector<HTMLElement>("[data-markdown-editor-input='true']")
        ?.focus()
    })
    toast.success("Message restored to editor.", { position: "bottom-right" })
  }

  async function submitDraft() {
    if (!draftHasContent() || sending) return
    const validationError = quickChatSendValidationError({
      auth,
      model: selection.currentModel,
      platform,
      projectPath: project?.path,
    })
    if (validationError) {
      showQuickChatError("Unable to send quick change", validationError)
      return
    }
    const messageBody = quickChatMessageBody(
      draft,
      draftCodeAttachments,
      draftFileAttachments
    )
    const codeAttachments = draftCodeAttachments
    const fileAttachments = draftFileAttachments
    setSending(true)
    try {
      const chat = await activeOrCreatedConversation(messageBody)
      const message = await quickChats.createMessage(chat, {
        body: messageBody,
        codeSelectionAttachments: codeAttachments,
        fileAttachments,
      })
      clearDraft()
      replaceChatRef(chatWithMessage(currentChat(chat), message))
      await runAgentForMessage(chat, message, codeAttachments, fileAttachments)
    } catch (error) {
      showQuickChatError("Quick chat failed", errorMessage(error))
    } finally {
      setSending(false)
    }
  }

  async function cancelAgent() {
    const conversation = activeConversation
      ? currentChat(activeConversation)
      : undefined
    const run = conversation?.agentRuns?.findLast(
      (currentRun) => currentRun.status === "running"
    )
    const sessionId = run?.clineSessionId ?? conversation?.clineSessionId
    if (
      !conversation ||
      !agentRunning ||
      !sessionId ||
      !platform.agent ||
      cancelingAgent
    )
      return
    setCancelingAgent(true)
    try {
      await platform.agent.sessions.abort(sessionId)
      unsubscribeQuickChatAgentEvents(sessionId)
      const persisted = persistAgentEvent(conversation, run, stoppedAgentEvent)
      toast.success("Agent stopped.", {
        position: "bottom-right",
      })
      await Promise.resolve(persisted).catch(reportAgentPersistenceError)
    } catch (error) {
      showQuickChatError("Unable to cancel agent", errorMessage(error))
    } finally {
      setCancelingAgent(false)
    }
  }

  async function activeOrCreatedConversation(message: string) {
    if (activeConversation) {
      return currentChat(await detailedConversation(activeConversation))
    }
    const chat = await quickChats.create({
      title: titleFromMessage(message, project?.name),
      workspace: project?.path ?? null,
    })
    replaceChatRef(chat)
    void generateQuickChatTitle(chat, message)
    return chat
  }

  async function generateQuickChatTitle(chat: QuickChat, message: string) {
    const generateTitle = platform.agent?.promptOptimizer.generateTitle
    const model = selection.currentModel
    if (
      !generateTitle ||
      !model ||
      !project?.path ||
      auth.status !== "authenticated"
    )
      return
    try {
      const title = await generateAgentTitle(generateTitle, {
        apiConnection: auth.apiConnection,
        context: "quick-chat",
        providerId: model.provider.id,
        modelId: model.id,
        credentialLabel: model.credentialLabel,
        reasoningEffort: selection.currentVariant,
        prompt: message,
        workspace: project.path,
      })
      const updatedChat = await quickChats.update(currentChat(chat), { title })
      replaceChatRef(updatedChat)
    } catch {
      return
    }
  }

  async function detailedConversation(conversation: QuickChat) {
    if (quickChats.chatDetailsLoaded(conversation)) {
      return currentChat(conversation)
    }
    const chat = await quickChats.loadDetail(conversation)
    replaceChatRef(chat)
    return chat
  }

  async function runAgentForMessage(
    chat: QuickChat,
    message: QuickChatMessage,
    codeAttachments: PendingCodeSelectionAttachment[],
    fileAttachments: UserStoryFileAttachment[]
  ) {
    const run = await quickChats.createAgentRun(chat, {
      kind: chat.clineSessionId ? "change-request" : "resume",
      messageId: message.id,
    })
    try {
      await startAgentSession(
        chat,
        run,
        message,
        codeAttachments,
        fileAttachments
      )
    } catch (error) {
      await markAgentRunFailed(chat, run, error)
      throw error
    }
  }

  async function startAgentSession(
    chat: QuickChat,
    run: QuickChatAgentRun,
    message: QuickChatMessage,
    codeAttachments: PendingCodeSelectionAttachment[],
    fileAttachments: UserStoryFileAttachment[]
  ) {
    const workspace = project!.path
    const resumeSessionId = chat.clineSessionId
    const title = quickChatTitle(chat, message.body, project?.name)
    const summary = quickChatDevelopmentSummary(chat, message.body)
    const executionId = crypto.randomUUID()
    const session = await startQuickChatDevelopmentSession({
      codeAttachments,
      executionId,
      fileAttachments,
      resumeSessionId,
      summary,
      title,
      workspace,
    })
    const reusedSession = Boolean(
      resumeSessionId && session.sessionId === resumeSessionId
    )
    const activeRun = await quickChats.updateAgentRun(chat, run, {
      clineSessionId: session.sessionId,
    })
    const updatedChat = await quickChats.update(currentChat(chat), {
      agentActivities: [],
      agentFinalResponse: null,
      agentLastError: null,
      agentLastEvent: `Cline debug log: ${quickChatClineLogPath(
        workspace,
        session.sessionId
      )}`,
      agentModelId: selection.currentModel!.id,
      agentProviderId: selection.currentModel!.provider.id,
      agentStatus: "Running",
      agentUsage: null,
      clineSessionId: session.sessionId,
      title,
      workspace,
    })
    replaceChatRef(updatedChat)
    subscribeQuickChatAgentEvents(updatedChat, activeRun, session.sessionId)
    await sendQuickChatPrompt({
      codeAttachments,
      executionId,
      fileAttachments,
      message,
      reusedSession,
      run: activeRun,
      sessionId: session.sessionId,
      summary,
      title,
      chat: updatedChat,
    })
  }

  async function startQuickChatDevelopmentSession(
    input: QuickChatDevelopmentSessionInput
  ) {
    return platform.agent!.sessions.startDevelopment({
      apiConnection: auth.apiConnection,
      providerId: selection.currentModel!.provider.id,
      modelId: selection.currentModel!.id,
      credentialLabel: selection.currentModel!.credentialLabel,
      reasoningEffort: selection.currentVariant,
      contextCompressionMode: selection.contextCompressionMode,
      autoSendPrompt: false,
      title: input.title,
      summary: input.summary,
      codeSelectionAttachments: input.codeAttachments,
      fileAttachments: input.fileAttachments,
      cwd: input.workspace,
      resumeSessionId: input.resumeSessionId,
      workspaceRoot: input.workspace,
      previewDevtoolsScope: projectRunConfigurationPreviewKey(
        previewConfiguration,
        input.workspace
      ),
      codePractices: await projectCodePractices(auth, projects),
      executionId: input.executionId,
    })
  }

  function subscribeQuickChatAgentEvents(
    chat: QuickChat,
    run: QuickChatAgentRun,
    sessionId: string
  ) {
    let authenticationFailed = false
    unsubscribeQuickChatAgentEvents(sessionId)
    const unsubscribe = subscribeAgentEvents(platform, sessionId, (event) => {
      if (authenticationFailed) return
      const text = agentEventText(event)
      authenticationFailed = quickChatExpiredAuthenticationToken(text)
      if (authenticationFailed) showExpiredAuthenticationToast(text)
      const persisted = persistAgentEvent(chat, run, event)
      if (authenticationFailed || immediateQuickChatAgentEvent(event)) {
        void Promise.resolve(persisted).then(
          () => unsubscribeQuickChatAgentEvents(sessionId, unsubscribe),
          () => unsubscribeQuickChatAgentEvents(sessionId, unsubscribe)
        )
      }
    })
    agentEventUnsubscribers.current.set(sessionId, unsubscribe)
    return unsubscribe
  }

  function unsubscribeQuickChatAgentEvents(
    sessionId: string,
    expected?: () => void
  ) {
    const unsubscribe = agentEventUnsubscribers.current.get(sessionId)
    if (!unsubscribe || (expected && unsubscribe !== expected)) return
    agentEventUnsubscribers.current.delete(sessionId)
    unsubscribe()
  }

  async function sendQuickChatPrompt(input: QuickChatPromptInput) {
    try {
      await platform.agent!.sessions.sendDevelopment(quickChatSendInput(input))
    } catch (error) {
      const message = errorMessage(error)
      persistAgentEvent(input.chat, input.run, {
        payload: { message },
        sessionId: input.sessionId,
        type: "error",
      })
    }
  }

  async function markAgentRunFailed(
    chat: QuickChat,
    run: QuickChatAgentRun,
    error: unknown
  ) {
    const message = errorMessage(error)
    const completedAt = new Date().toISOString()
    const chatInput = {
      agentLastError: message,
      agentLastEvent: message,
      agentStatus: null,
    }
    const runInput = {
      completedAt,
      finalResponse: message,
      status: "failed" as const,
    }
    updateChatLocal(chat, chatInput)
    quickChats.updateAgentRunLocal(chat, run, runInput)
    await Promise.all([
      quickChats.update(chat, chatInput).catch(() => undefined),
      quickChats.updateAgentRun(chat, run, runInput).catch(() => undefined),
    ])
  }

  function draftHasContent() {
    return Boolean(
      draft.trim() || draftCodeAttachments.length || draftFileAttachments.length
    )
  }

  function clearDraft() {
    removeComposerDraft(localStorage, draftStorageKey)
    setDraft("")
    setDraftCodeAttachments([])
    setDraftFileAttachments([])
    setDraftEditorKey((key) => key + 1)
  }

  return (
    <>
      <div className="flex h-svh min-h-0 min-w-0 flex-col overflow-hidden md:h-[calc(100svh_-_1rem)]">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2">
          <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden">
            <MessageScrollerProvider key={activeConversation?.id ?? "new-chat"}>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    aria-busy={agentRunning}
                    className="mx-auto w-full max-w-4xl gap-10 px-4 pt-[calc(var(--header-height)+1rem)] pb-48 md:px-8"
                  >
                    <QuickChatStatus
                      error={quickChats.error}
                      loading={quickChats.loading || !activeConversationLoaded}
                      projectPath={project?.path}
                    />
                    {activeConversationLoaded &&
                    activeConversation?.agentRuns?.length ? (
                      <AgentConversationTimeline
                        comments={activeConversation.messages ?? []}
                        onFileLinkClick={(path) =>
                          openProjectPath(
                            project?.path,
                            path,
                            platform.openPath
                          )
                        }
                        onLoadActivityDetail={(run, activity) =>
                          quickChats.agentRunActivityDetail(
                            activeConversation,
                            run,
                            activity
                          )
                        }
                        onUserMessageUndo={undoQuickChatMessage}
                        responseHeader={responseHeader}
                        runs={activeConversation.agentRuns}
                      />
                    ) : activeConversationLoaded ? (
                      <QuickChatEmptyState />
                    ) : null}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton className="bottom-40 md:bottom-44" />
              </MessageScroller>
            </MessageScrollerProvider>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 pt-10 md:pt-12">
              <div
                className="absolute inset-0 bg-background/40 backdrop-blur-xl"
                style={bottomBlurMask}
              />
              <div className="pointer-events-auto relative px-3 pb-3 md:px-5 md:pb-5">
                <div className="mx-auto max-w-4xl">
                  <AgentConversationComposer
                    agentRunning={agentRunning}
                    cancelingAgent={cancelingAgent}
                    codeSelectionAttachments={draftCodeAttachments}
                    disabled={sending || agentRunning || !project}
                    editorKey={draftEditorKey}
                    editorRef={draftRef}
                    fileAttachments={pendingFileAttachments(
                      draftFileAttachments
                    )}
                    mentionDirectory={mentionDirectory}
                    message={draft}
                    onCodeSelectionAttachmentRemove={(id) =>
                      setDraftCodeAttachments((current) =>
                        current.filter((attachment) => attachment.id !== id)
                      )
                    }
                    onFileAttachmentRemove={(id) =>
                      setDraftFileAttachments((current) =>
                        current.filter((attachment) => attachment.id !== id)
                      )
                    }
                    onFileAttachmentsAdd={(attachments) =>
                      setDraftFileAttachments((current) => [
                        ...current,
                        ...attachments,
                      ])
                    }
                    onFileLinkClick={(path) =>
                      openProjectPath(project?.path, path, platform.openPath)
                    }
                    onMessageChange={setDraft}
                    onMessageSubmit={submitDraft}
                    onAgentCancel={cancelAgent}
                    placeholder={
                      agentRunning
                        ? "Agent is working in the current branch."
                        : "Ask for a focused code change"
                    }
                    submitLabel={agentRunning ? "Running" : "Send"}
                    toolbarEnd={
                      <div className="w-[28rem] max-w-full min-w-0">
                        <ModelSelector role="agent" />
                      </div>
                    }
                  />
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
      <ProjectRunConfigurationPreviewWarmup
        configuration={previewConfiguration}
        devtoolsTarget
        scope={project?.path}
      />
    </>
  )
}

function QuickChatStatus({
  error,
  loading,
  projectPath,
}: {
  error?: string
  loading: boolean
  projectPath?: string
}) {
  if (!projectPath) {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Open a project to use quick chat.
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (!loading) return null
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      Loading quick chats.
    </div>
  )
}

function QuickChatEmptyState() {
  return (
    <div className="grid min-h-[18rem] place-items-center">
      <div className="grid max-w-md justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <SendIcon className="size-5" />
        </span>
        <div className="grid gap-1">
          <h2 className="font-heading text-xl font-semibold">
            Start with a small change
          </h2>
          <p className="text-sm text-muted-foreground">
            Keep it focused, attach files when useful, and the thread stays in
            this project history.
          </p>
        </div>
      </div>
    </div>
  )
}

async function restoreQuickChatCheckpoint(
  platform: Platform,
  chat: QuickChat,
  sessionId: string | null | undefined,
  checkpointRunCount: number
) {
  if (!platform.agent)
    throw new Error("Desktop agent runtime is not available.")
  if (!sessionId) throw new Error("This message has no Cline session.")
  if (!chat.workspace) throw new Error("This quick chat has no workspace.")
  return platform.agent.sessions.restoreCheckpoint({
    checkpointRunCount,
    cwd: chat.workspace,
    restore: {
      messages: true,
      omitCheckpointMessageFromSession: true,
      workspace: false,
    },
    sessionId,
  })
}

function quickChatSendValidationError(input: {
  auth: ReturnType<typeof useCloudAuth>
  model: ReturnType<typeof useModelSelection>["currentModel"]
  platform: Platform
  projectPath?: string
}) {
  if (!input.projectPath) return "Open a project first."
  if (input.auth.status !== "authenticated")
    return "Reconnect the selected provider."
  if (!input.model) return "Select a model first."
  if (!input.platform.agent) return "Desktop agent runtime is not available."
}

function quickChatMessageBody(
  draft: string,
  codeAttachments: PendingCodeSelectionAttachment[],
  fileAttachments: UserStoryFileAttachment[]
) {
  if (draft.trim()) return draft.trim()
  if (codeAttachments.length || fileAttachments.length)
    return "Attached context"
  return ""
}

function quickChatSendInput(input: QuickChatPromptInput) {
  if (input.reusedSession) {
    return {
      feedback: input.message.body,
      feedbackCodeSelectionAttachments: input.codeAttachments,
      feedbackFileAttachments: input.fileAttachments,
      feedbackOnly: true,
      executionId: input.executionId,
      sessionId: input.sessionId,
      summary: input.summary,
      title: input.title,
    }
  }
  return {
    codeSelectionAttachments: input.codeAttachments,
    executionId: input.executionId,
    fileAttachments: input.fileAttachments,
    sessionId: input.sessionId,
    summary: input.summary,
    title: input.title,
  }
}

function quickChatDevelopmentSummary(chat: QuickChat, message: string) {
  const context = quickChatResumeContext(chat)
  if (!context.length) return message
  return [message, "", "Existing quick chat context:", ...context].join("\n")
}

function quickChatResumeContext(chat: QuickChat) {
  return [
    chat.agentSessionSummary
      ? `Previous session summary:\n${chat.agentSessionSummary}`
      : "",
    chat.agentFinalResponse
      ? `Last agent response:\n${chat.agentFinalResponse}`
      : "",
    ...quickChatRecentMessages(chat),
    ...quickChatRecentRunSummaries(chat),
    chat.agentLastEvent ? `Last recorded event: ${chat.agentLastEvent}` : "",
    chat.agentLastError ? `Previous agent error: ${chat.agentLastError}` : "",
  ].filter(Boolean)
}

function quickChatRecentMessages(chat: QuickChat) {
  return (chat.messages ?? []).slice(-6).map((item) => {
    const body = item.body.trim()
    return body ? `User message: ${body}` : ""
  })
}

function quickChatRecentRunSummaries(chat: QuickChat) {
  return (chat.agentRuns ?? []).slice(-3).map((run) => {
    const summary = run.sessionSummary?.trim()
    return summary ? `Agent run summary: ${summary}` : ""
  })
}

function chatWithMessage(chat: QuickChat, message: QuickChatMessage) {
  return {
    ...chat,
    messages: [...(chat.messages ?? []), message],
  }
}

function defaultQuickChatTitle(projectName: string | undefined) {
  return projectName ? `${projectName} quick change` : "Quick change"
}

function quickChatTitle(
  chat: QuickChat,
  message: string,
  projectName: string | undefined
) {
  if ((chat.messages?.length ?? 0) > 1) return chat.title
  if (chat.title !== defaultQuickChatTitle(projectName)) return chat.title
  return titleFromMessage(message, projectName)
}

function titleFromMessage(message: string, projectName: string | undefined) {
  const fallback = defaultQuickChatTitle(projectName)
  return shortLabel(message.replace(/[#*_`>[\]()]/g, " ").trim(), 56, fallback)
}

function shortLabel(
  value: string,
  maxLength: number,
  fallback = "Quick change"
) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return fallback
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}...`
}

function openProjectPath(
  root: string | undefined,
  path: string,
  openPath: ((path: string) => Promise<string>) | undefined
) {
  if (!openPath) return
  const target = path.startsWith("/") || !root ? path : `${root}/${path}`
  void openPath(target)
}

function showExpiredAuthenticationToast(message: string) {
  toast.error("Agent authentication expired", {
    description: `${message} Reconnect the selected provider, then send again.`,
    position: "bottom-right",
  })
}

function showQuickChatError(title: string, description: string) {
  toast.error(title, {
    description,
    position: "bottom-right",
  })
}

function reportAgentPersistenceError(error: unknown) {
  console.error("Failed to persist quick chat agent update.", error)
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
