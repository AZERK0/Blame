import * as React from "react"
import type { AgentEvent } from "@blame/agent-runtime"
import {
  CheckCircle2Icon,
  CopyIcon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageCircleIcon,
  MessageCirclePlusIcon,
  SendIcon,
  Trash2Icon,
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
  AgentConversationComposer,
  AgentConversationTimeline,
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
import type {
  QuickChat,
  QuickChatAgentRun,
  QuickChatAgentRunUpdate,
  QuickChatMessage,
  QuickChatUpdate,
} from "@/components/chat/data/quick-chat-data"
import { useQuickChatStore } from "@/components/chat/data/quick-chat-store"
import { agentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { projectCodePractices } from "@/lib/project-code-practices"
import { cn } from "@/lib/utils"

const agentEventPersistDelayMs = 1_500

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

type QuickChatConversationActions = {
  onCopyAgentResponse(conversation: QuickChat): void
  onCopyLastMessage(conversation: QuickChat): void
  onCopyTitle(conversation: QuickChat): void
  onDelete(conversation: QuickChat): void
  onSelect(id: number): void
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
  const quickChats = useQuickChatStore()
  const selection = useModelSelection({ role: "agent" })
  const project = projects.activeProject
  const [draft, setDraft] = React.useState("")
  const [draftEditorKey, setDraftEditorKey] = React.useState(0)
  const [draftCodeAttachments, setDraftCodeAttachments] = React.useState<
    PendingCodeSelectionAttachment[]
  >([])
  const [draftFileAttachments, setDraftFileAttachments] = React.useState<
    UserStoryFileAttachment[]
  >([])
  const [newConversationActive, setNewConversationActive] =
    React.useState(false)
  const [conversationToDelete, setConversationToDelete] =
    React.useState<QuickChat | null>(null)
  const [deletingConversation, setDeletingConversation] = React.useState(false)
  const [gitStatus, setGitStatus] = React.useState<GitStatusResult>()
  const [sending, setSending] = React.useState(false)
  const chatsRef = React.useRef(quickChats.chats)
  const pendingAgentUpdates = React.useRef(
    new Map<number, PendingQuickChatAgentUpdate>()
  )
  const draftRef = React.useRef<HTMLDivElement>(null)
  const feedEndRef = React.useRef<HTMLDivElement>(null)
  const activeConversation = newConversationActive
    ? undefined
    : quickChats.activeChat
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
  const conversationActions: QuickChatConversationActions = {
    onCopyAgentResponse: copyConversationAgentResponse,
    onCopyLastMessage: copyConversationLastMessage,
    onCopyTitle: copyConversationTitle,
    onDelete: requestConversationDeletion,
    onSelect: selectConversation,
  }

  React.useEffect(() => {
    chatsRef.current = quickChats.chats
  }, [quickChats.chats])

  React.useEffect(() => {
    return loadGitStatus(project?.path, platform.workspace, setGitStatus)
  }, [platform.workspace, project?.path])

  React.useEffect(() => {
    const updates = pendingAgentUpdates.current
    return () => clearPendingQuickChatAgentUpdates(updates)
  }, [])

  React.useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "end" })
  }, [
    activeConversation?.agentLastEvent,
    activeConversation?.agentRuns?.length,
    activeConversation?.id,
    activeConversation?.messages?.length,
  ])

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
    persistAgentUpdate(
      current,
      run,
      update,
      runInput,
      immediateQuickChatAgentEvent(event)
    )
  }

  function createConversation() {
    if (!project) {
      showQuickChatError("Unable to create quick chat", "Open a project first.")
      return
    }
    setNewConversationActive(true)
    clearDraft()
  }

  function selectConversation(id: number) {
    setNewConversationActive(false)
    quickChats.setActiveId(id)
    clearDraft()
  }

  function requestConversationDeletion(conversation: QuickChat) {
    setConversationToDelete(conversation)
  }

  async function deleteConversation() {
    const conversation = conversationToDelete
    if (!conversation || deletingConversation) return
    setDeletingConversation(true)
    try {
      await quickChats.remove(conversation)
      chatsRef.current = chatsRef.current.filter(
        (chat) => chat.id !== conversation.id
      )
      setConversationToDelete(null)
    } catch (error) {
      showQuickChatError("Unable to delete quick chat", errorMessage(error))
    } finally {
      setDeletingConversation(false)
    }
  }

  function copyConversationTitle(conversation: QuickChat) {
    void copyConversationText(conversation.title, "Conversation title copied.")
  }

  function copyConversationLastMessage(conversation: QuickChat) {
    const message = lastConversationMessageText(conversation)
    if (!message) return
    void copyConversationText(message, "Last message copied.")
  }

  function copyConversationAgentResponse(conversation: QuickChat) {
    const response = lastAgentResponseText(conversation)
    if (!response) return
    void copyConversationText(response, "Last agent response copied.")
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
    if (activeConversation) return currentChat(activeConversation)
    const chat = await quickChats.create({
      title: titleFromMessage(message, project?.name),
      workspace: project?.path ?? null,
    })
    replaceChatRef(chat)
    setNewConversationActive(false)
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
      if (
        authenticationFailed ||
        event.type === "done" ||
        event.type === "error"
      ) {
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
      <div className="flex h-[calc(100svh_-_var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden p-4 md:h-[calc(100svh_-_var(--header-height)_-_1rem)] lg:p-6">
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            <QuickChatHeader
              activeId={activeConversation?.id}
              branchName={branchName}
              changeCount={gitStatus?.files.length}
              conversationActions={conversationActions}
              conversations={quickChats.chats}
              projectName={project?.name ?? "Project"}
              projectPath={project?.path ?? ""}
              onCreate={createConversation}
            />
            <ScrollArea className="min-h-0 flex-1">
              <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-8 md:px-8">
                <QuickChatStatus
                  error={quickChats.error}
                  loading={quickChats.loading}
                  projectPath={project?.path}
                />
                {activeConversation?.agentRuns?.length ? (
                  <AgentConversationTimeline
                    comments={activeConversation.messages ?? []}
                    onFileLinkClick={(path) =>
                      openProjectPath(project?.path, path, platform.openPath)
                    }
                    onLoadActivityDetail={(run, activity) =>
                      quickChats.agentRunActivityDetail(
                        activeConversation,
                        run,
                        activity
                      )
                    }
                    responseHeader={responseHeader}
                    runs={activeConversation.agentRuns}
                  />
                ) : (
                  <QuickChatEmptyState />
                )}
                <div ref={feedEndRef} />
              </div>
            </ScrollArea>
            <div className="p-3 md:p-5">
              <div className="mx-auto max-w-5xl">
                <AgentConversationComposer
                  codeSelectionAttachments={draftCodeAttachments}
                  disabled={sending || agentRunning || !project}
                  editorKey={draftEditorKey}
                  editorRef={draftRef}
                  fileAttachments={pendingFileAttachments(draftFileAttachments)}
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
                  title="Message agent"
                  toolbarEnd={
                    <div className="w-[28rem] max-w-full min-w-0">
                      <ModelSelector role="agent" />
                    </div>
                  }
                />
              </div>
            </div>
          </main>
          <QuickChatHistoryPanel
            activeId={activeConversation?.id}
            conversationActions={conversationActions}
            conversations={quickChats.chats}
            onCreate={createConversation}
          />
        </div>
      </div>
      <DeleteQuickChatDialog
        conversation={conversationToDelete}
        deleting={deletingConversation}
        onCancel={() => setConversationToDelete(null)}
        onConfirm={deleteConversation}
      />
    </>
  )
}

function QuickChatHistoryPanel({
  activeId,
  conversationActions,
  conversations,
  onCreate,
}: {
  activeId?: number
  conversationActions: QuickChatConversationActions
  conversations: QuickChat[]
  onCreate: () => void
}) {
  return (
    <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-2xl border bg-card shadow-xl ring-1 shadow-black/10 ring-foreground/10 xl:flex">
      <div className="flex items-center justify-between gap-3 border-b bg-muted/20 px-4 py-4">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">Quick chats</h2>
          <p className="truncate text-xs text-muted-foreground">
            {conversations.length} conversation
            {conversations.length > 1 ? "s" : ""}
          </p>
        </div>
        <Button
          aria-label="New quick chat"
          onClick={onCreate}
          size="icon-sm"
          type="button"
          variant="outline"
        >
          <MessageCirclePlusIcon />
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1 bg-muted/10 dark:bg-muted/20">
        <div className="grid gap-2 p-3">
          {conversations.map((conversation) => (
            <QuickChatHistoryItem
              active={conversation.id === activeId}
              conversationActions={conversationActions}
              conversation={conversation}
              key={conversation.id}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

function QuickChatHistoryItem({
  active,
  conversationActions,
  conversation,
}: {
  active: boolean
  conversationActions: QuickChatConversationActions
  conversation: QuickChat
}) {
  return (
    <QuickChatConversationContextMenu
      actions={conversationActions}
      conversation={conversation}
    >
      <button
        className={cn(
          "grid min-w-0 gap-1.5 rounded-xl border p-2.5 text-left text-sm ring-1 ring-foreground/10 transition-colors",
          active
            ? "border-blue-500/40 bg-blue-500/10"
            : "border-border/60 bg-input/40 hover:border-border hover:bg-input/10 dark:bg-muted dark:hover:bg-muted/50"
        )}
        onClick={() => conversationActions.onSelect(conversation.id)}
        type="button"
      >
        <span className="flex min-w-0 items-start gap-2">
          <MessageCircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium">
            {conversation.title}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {relativeTimeLabel(conversation.updatedAt ?? conversation.createdAt)}
          </span>
        </span>
        <span className="line-clamp-1 text-xs leading-snug text-muted-foreground">
          {conversationPreview(conversation)}
        </span>
      </button>
    </QuickChatConversationContextMenu>
  )
}

function QuickChatHeader({
  activeId,
  branchName,
  changeCount,
  conversationActions,
  conversations,
  projectName,
  projectPath,
  onCreate,
}: {
  activeId?: number
  branchName: string
  changeCount?: number
  conversationActions: QuickChatConversationActions
  conversations: QuickChat[]
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
      <div className="flex items-center gap-2 overflow-x-auto pb-3 xl:hidden">
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
        {conversations.map((conversation) => (
          <QuickChatConversationContextMenu
            actions={conversationActions}
            conversation={conversation}
            key={conversation.id}
          >
            <button
              className={cn(
                "h-7 max-w-56 shrink-0 rounded-lg border px-2 text-sm transition-colors",
                conversation.id === activeId
                  ? "border-blue-500/40 bg-blue-500/10 text-foreground"
                  : "border-border bg-background/60 text-muted-foreground"
              )}
              onClick={() => conversationActions.onSelect(conversation.id)}
              type="button"
            >
              <span className="block truncate">{conversation.title}</span>
            </button>
          </QuickChatConversationContextMenu>
        ))}
      </div>
    </header>
  )
}

function QuickChatConversationContextMenu({
  actions,
  children,
  conversation,
}: {
  actions: QuickChatConversationActions
  children: React.ReactNode
  conversation: QuickChat
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <QuickChatConversationMenuItems
          actions={actions}
          conversation={conversation}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}

function QuickChatConversationMenuItems({
  actions,
  conversation,
}: {
  actions: QuickChatConversationActions
  conversation: QuickChat
}) {
  const lastMessage = lastConversationMessageText(conversation)
  const lastAgentResponse = lastAgentResponseText(conversation)
  const agentRunning = conversation.agentStatus === "Running"

  return (
    <>
      <ContextMenuItem onSelect={() => actions.onSelect(conversation.id)}>
        <MessageCircleIcon className="size-4" />
        Open conversation
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => actions.onCopyTitle(conversation)}>
        <CopyIcon className="size-4" />
        Copy title
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!lastMessage}
        onSelect={() => actions.onCopyLastMessage(conversation)}
      >
        <CopyIcon className="size-4" />
        Copy last message
      </ContextMenuItem>
      <ContextMenuItem
        disabled={!lastAgentResponse}
        onSelect={() => actions.onCopyAgentResponse(conversation)}
      >
        <CopyIcon className="size-4" />
        Copy last agent response
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem
        disabled={agentRunning}
        onSelect={() => actions.onDelete(conversation)}
        variant="destructive"
      >
        <Trash2Icon className="size-4" />
        Delete conversation
      </ContextMenuItem>
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

function DeleteQuickChatDialog({
  conversation,
  deleting,
  onCancel,
  onConfirm,
}: {
  conversation: QuickChat | null
  deleting: boolean
  onCancel(): void
  onConfirm(): void
}) {
  return (
    <AlertDialog
      open={Boolean(conversation)}
      onOpenChange={(open) => {
        if (!open && !deleting) onCancel()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogMedia>
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle>Delete conversation</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this quick chat from the database.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={deleting}
            variant="destructive"
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
          >
            Delete permanently
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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

function conversationPreview(conversation: QuickChat) {
  if (conversation.agentStatus === "Running") {
    return shortLabel(conversation.agentLastEvent ?? "Agent is working", 96)
  }
  if (conversation.agentLastError) {
    return shortLabel(conversation.agentLastError, 96)
  }
  const message = conversation.messages?.at(-1)
  if (message) return shortLabel(message.body || "Attached context", 96)
  return shortLabel(conversation.agentLastEvent ?? "No messages yet", 96)
}

function lastConversationMessageText(conversation: QuickChat) {
  return conversation.messages?.at(-1)?.body.trim() ?? ""
}

function lastAgentResponseText(conversation: QuickChat) {
  const response = conversation.agentFinalResponse?.trim()
  if (response) return response
  const runs = conversation.agentRuns ?? []
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const runResponse = runs[index]?.finalResponse?.trim()
    if (runResponse) return runResponse
  }
  return ""
}

async function copyConversationText(value: string, successMessage: string) {
  try {
    await writeClipboardText(value)
    toast.success(successMessage, { position: "bottom-right" })
  } catch (error) {
    showQuickChatError("Unable to copy", errorMessage(error))
  }
}

async function writeClipboardText(value: string) {
  if (!navigator.clipboard?.writeText) {
    throw new Error("Clipboard is not available.")
  }
  await navigator.clipboard.writeText(value)
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

function relativeTimeLabel(value: string) {
  const date = new Date(value)
  const diffMs = Date.now() - date.getTime()
  if (Number.isNaN(diffMs) || diffMs < 60_000) return "Just now"
  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
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
