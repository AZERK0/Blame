import * as React from "react"
import type { AgentEvent } from "@blame/agent-runtime"
import {
  CheckCircle2Icon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageCirclePlusIcon,
  SendIcon,
} from "lucide-react"
import { toast } from "sonner"

import type {
  GitStatusResult,
  Platform,
  WorkspaceClient,
} from "@/context/platform"
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
  definedQuickChatUpdate,
  immediateQuickChatAgentEvent,
  pendingQuickChatAgentUpdate,
  quickChatAgentEventUpdate,
  quickChatAgentMetadataUpdate,
  quickChatAgentRunEventUpdate,
  quickChatAgentRunMetadataUpdate,
  quickChatClineLogPath,
  quickChatExpiredAuthenticationToken,
  type PendingQuickChatAgentUpdate,
  type QueuedQuickChatAgentUpdate,
} from "@/components/chat/data/quick-chat-agent-flow"
import {
  quickChatSelectedEvent,
  type QuickChat,
  type QuickChatAgentRun,
  type QuickChatAgentRunUpdate,
  type QuickChatMessage,
  type QuickChatUpdate,
} from "@/components/chat/data/quick-chat-data"
import { useQuickChatStore } from "@/components/chat/data/quick-chat-store"
import { agentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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

const agentEventPersistDelayMs = 1_500
const topStrongBlurMask = {
  maskImage: "linear-gradient(to bottom, black 0%, transparent 72%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 72%)",
} satisfies React.CSSProperties
const bottomBlurMask = {
  maskImage: "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to top, black 0%, black 60%, transparent 100%)",
} satisfies React.CSSProperties

type QuickChatDevelopmentSessionInput = {
  codeAttachments: PendingCodeSelectionAttachment[]
  fileAttachments: UserStoryFileAttachment[]
  resumeSessionId?: string | null
  summary: string
  title: string
  workspace: string
}

type QuickChatPromptInput = {
  chat: QuickChat
  codeAttachments: PendingCodeSelectionAttachment[]
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
  const [gitStatus, setGitStatus] = React.useState<GitStatusResult>()
  const [sending, setSending] = React.useState(false)
  const chatsRef = React.useRef(quickChats.chats)
  const pendingAgentUpdates = React.useRef(
    new Map<string, PendingQuickChatAgentUpdate>()
  )
  const draftRef = React.useRef<HTMLDivElement>(null)
  const activeConversation = quickChats.activeChat
  const activeConversationLoaded =
    !activeConversation || quickChats.chatDetailsLoaded(activeConversation)
  const responseHeader = agentConversationResponseHeader({
    modelId: activeConversation?.agentModelId ?? selection.currentModel?.id,
    providerId:
      activeConversation?.agentProviderId ??
      selection.currentModel?.provider.id,
    providers: selection.allProviders,
  })
  const branchName = gitStatus?.branch.current ?? "Current branch"
  const mentionDirectory = project?.path
  const agentRunning = activeConversation?.agentStatus === "Running"
  React.useEffect(() => {
    chatsRef.current = quickChats.chats
  }, [quickChats.chats])

  React.useEffect(() => {
    return loadGitStatus(project?.path, platform.workspace, setGitStatus)
  }, [platform.workspace, project?.path])

  React.useEffect(() => {
    if (!activeConversation || quickChats.chatDetailsLoaded(activeConversation))
      return
    void quickChats.loadDetail(activeConversation).catch((error) => {
      showQuickChatError("Unable to load quick chat", errorMessage(error))
    })
  }, [activeConversation, quickChats])

  React.useEffect(() => {
    const updates = pendingAgentUpdates.current
    return () => clearPendingQuickChatAgentUpdates(updates)
  }, [])

  React.useEffect(() => {
    const clearSelectedChatDraft = () => {
      setDraft("")
      setDraftCodeAttachments([])
      setDraftFileAttachments([])
      setDraftEditorKey((key) => key + 1)
    }
    window.addEventListener(quickChatSelectedEvent, clearSelectedChatDraft)
    return () =>
      window.removeEventListener(quickChatSelectedEvent, clearSelectedChatDraft)
  }, [])

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
      void flushAgentUpdate(nextChat, run, input, runInput).catch(
        reportAgentPersistenceError
      )
      return
    }
    queueAgentUpdate(nextChat, run, input, runInput)
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
    persistAgentUpdate(
      current,
      run,
      update,
      runInput,
      immediateQuickChatAgentEvent(event)
    )
  }

  function notifyQuickChatResponseCompleted(chat: QuickChat) {
    void showSystemNotification(platform, {
      body: chat.title,
      title: "Agent response ready",
    })
  }

  function createConversation() {
    if (!project) {
      showQuickChatError("Unable to create quick chat", "Open a project first.")
      return
    }
    quickChats.setActiveId(undefined)
    clearDraft()
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
    clearDraft()
    setSending(true)
    try {
      const chat = await activeOrCreatedConversation(messageBody)
      const message = await quickChats.createMessage(chat, {
        body: messageBody,
        codeSelectionAttachments: codeAttachments,
        fileAttachments,
      })
      replaceChatRef(chatWithMessage(currentChat(chat), message))
      await runAgentForMessage(chat, message, codeAttachments, fileAttachments)
    } catch (error) {
      showQuickChatError("Quick chat failed", errorMessage(error))
    } finally {
      setSending(false)
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
    setNewConversationActive(false)
    return chat
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
    const session = await startQuickChatDevelopmentSession({
      codeAttachments,
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
    })
  }

  function subscribeQuickChatAgentEvents(
    chat: QuickChat,
    run: QuickChatAgentRun,
    sessionId: string
  ) {
    let authenticationFailed = false
    const unsubscribe = subscribeAgentEvents(platform, sessionId, (event) => {
      if (authenticationFailed) return
      const text = agentEventText(event)
      authenticationFailed = quickChatExpiredAuthenticationToken(text)
      if (authenticationFailed) showExpiredAuthenticationToast(text)
      persistAgentEvent(chat, run, event)
      if (authenticationFailed || immediateQuickChatAgentEvent(event)) {
        unsubscribe()
      }
    })
    return unsubscribe
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
    setDraft("")
    setDraftCodeAttachments([])
    setDraftFileAttachments([])
    setDraftEditorKey((key) => key + 1)
  }

  return (
    <>
      <div className="flex h-[calc(100svh_-_var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden md:h-[calc(100svh_-_var(--header-height)_-_1rem)]">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-2">
          <main className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-background/70">
            <div className="pointer-events-none absolute inset-x-0 top-0 z-20 pb-10 md:pb-12">
              <div
                className="absolute inset-0 backdrop-blur-xl"
                style={topStrongBlurMask}
              />
              <div className="pointer-events-auto relative">
                <QuickChatHeader
                  branchName={branchName}
                  changeCount={gitStatus?.files.length}
                  projectName={project?.name ?? "Project"}
                  projectPath={project?.path ?? ""}
                  onCreate={createConversation}
                />
              </div>
            </div>
            <MessageScrollerProvider key={activeConversation?.id ?? "new-chat"}>
              <MessageScroller>
                <MessageScrollerViewport>
                  <MessageScrollerContent
                    aria-busy={agentRunning}
                    className="mx-auto w-full max-w-4xl gap-10 px-4 pt-24 pb-48 md:px-8 md:pt-28"
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

function QuickChatHeader({
  branchName,
  changeCount,
  projectName,
  projectPath,
  onCreate,
}: {
  branchName: string
  changeCount?: number
  projectName: string
  projectPath: string
  onCreate: () => void
}) {
  return (
    <header className="grid gap-4 px-4 pt-4 md:px-6 md:pt-5">
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted-foreground">
            Quick change
          </div>
          <h1 className="mt-1 truncate font-heading text-2xl font-semibold">
            Fast agent chat
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {projectPath}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="max-w-64 justify-start gap-1" variant="outline">
            <FolderGit2Icon className="size-3" />
            <span className="truncate">{projectName}</span>
          </Badge>
          <Badge className="max-w-56 justify-start gap-1" variant="secondary">
            <GitBranchIcon className="size-3" />
            <span className="truncate">{branchName}</span>
          </Badge>
          <Badge className="gap-1" variant="outline">
            <CheckCircle2Icon className="size-3" />
            {changeCount ?? 0} change{changeCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-2 pb-3">
        <Button
          className="shrink-0"
          onClick={onCreate}
          size="sm"
          type="button"
          variant="outline"
        >
          <MessageCirclePlusIcon />
          New
        </Button>
      </div>
    </header>
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

function loadGitStatus(
  root: string | undefined,
  workspace: WorkspaceClient | undefined,
  setGitStatus: React.Dispatch<
    React.SetStateAction<GitStatusResult | undefined>
  >
) {
  let cancelled = false
  setGitStatus(undefined)
  if (!root || !workspace) return () => undefined
  void workspace
    .gitStatus({ root })
    .then((status) => {
      if (!cancelled) setGitStatus(status)
    })
    .catch(() => {
      if (!cancelled) setGitStatus(undefined)
    })
  return () => {
    cancelled = true
  }
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
      sessionId: input.sessionId,
      summary: input.summary,
      title: input.title,
    }
  }
  return {
    codeSelectionAttachments: input.codeAttachments,
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
