import * as React from "react"
import {
  CheckCircle2Icon,
  Clock3Icon,
  FolderGit2Icon,
  GitBranchIcon,
  MessageCircleIcon,
  PlusIcon,
  SendIcon,
} from "lucide-react"

import type { GitStatusResult, WorkspaceClient } from "@/context/platform"
import type {
  UserStoryAgentActivity,
  UserStoryAgentRun,
  UserStoryComment,
  UserStoryFileAttachment,
} from "@/components/backlog/data/backlog-data"
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
import { agentConversationResponseHeader } from "@/components/chat/agent-conversation-header"
import {
  ModelSelector,
  useModelSelection,
} from "@/components/model/model-selector"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { cn } from "@/lib/utils"

const storagePrefix = "blame.app.quick-chat.v1"

type QuickChatState = {
  activeId: string
  conversations: QuickChatConversation[]
}

type QuickChatConversation = {
  comments: UserStoryComment[]
  createdAt: string
  id: string
  modelId?: string | null
  providerId?: string | null
  runs: UserStoryAgentRun[]
  storyId: number
  title: string
  updatedAt: string
}

export function ChatPage() {
  const projects = useProjects()
  const project = projects.activeProject
  const storageKey = `${storagePrefix}.${project?.id ?? "project"}`

  return <QuickChatProjectPage key={storageKey} storageKey={storageKey} />
}

function QuickChatProjectPage({ storageKey }: { storageKey: string }) {
  const platform = usePlatform()
  const projects = useProjects()
  const selection = useModelSelection()
  const project = projects.activeProject
  const [chatState, setChatState] = React.useState(() =>
    readQuickChatState(storageKey, project?.name)
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
  const draftRef = React.useRef<HTMLDivElement>(null)
  const feedEndRef = React.useRef<HTMLDivElement>(null)
  const activeConversation = activeQuickChatConversation(chatState)
  const responseHeader = agentConversationResponseHeader({
    modelId: activeConversation?.modelId ?? selection.currentModel?.id,
    providerId:
      activeConversation?.providerId ?? selection.currentModel?.provider.id,
    providers: selection.allProviders,
  })
  const branchName = gitStatus?.branch.current ?? "Current branch"
  const mentionDirectory = project?.path

  React.useEffect(() => {
    writeQuickChatState(storageKey, chatState)
  }, [chatState, storageKey])

  React.useEffect(() => {
    return loadGitStatus(project?.path, platform.workspace, setGitStatus)
  }, [platform.workspace, project?.path])

  React.useEffect(() => {
    feedEndRef.current?.scrollIntoView({ block: "end" })
  }, [activeConversation?.id, activeConversation?.runs.length])

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

  function createConversation() {
    setChatState((current) => addQuickChatConversation(current, project?.name))
    clearDraft()
  }

  function selectConversation(id: string) {
    setChatState((current) => ({ ...current, activeId: id }))
    clearDraft()
  }

  function submitDraft() {
    if (!activeConversation || !draftHasContent()) return
    const now = new Date().toISOString()
    const comment = createQuickChatComment({
      attachments: draftFileAttachments,
      body: draft,
      codeAttachments: draftCodeAttachments,
      conversation: activeConversation,
      now,
    })
    const run = createQuickChatRun({
      comment,
      conversation: activeConversation,
      modelId: selection.currentModel?.id,
      now,
      providerId: selection.currentModel?.provider.id,
    })
    setChatState((current) =>
      updateQuickChatConversation(current, activeConversation.id, (item) => ({
        ...item,
        comments: [...item.comments, comment],
        modelId: run.modelId,
        providerId: run.providerId,
        runs: [...item.runs, run],
        title: conversationTitle(item, draft),
        updatedAt: now,
      }))
    )
    clearDraft()
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
    <div className="flex h-[calc(100svh_-_var(--header-height))] min-h-0 min-w-0 flex-col overflow-hidden bg-background p-3 md:h-[calc(100svh_-_var(--header-height)_-_1rem)]">
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <QuickChatHistoryPanel
          activeId={chatState.activeId}
          conversations={chatState.conversations}
          onCreate={createConversation}
          onSelect={selectConversation}
        />
        <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <QuickChatHeader
            activeId={chatState.activeId}
            branchName={branchName}
            changeCount={gitStatus?.files.length}
            conversations={chatState.conversations}
            projectName={project?.name ?? "Project"}
            projectPath={project?.path ?? ""}
            onCreate={createConversation}
            onSelect={selectConversation}
          />
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto grid w-full max-w-5xl gap-10 px-4 py-8 md:px-8">
              {activeConversation && activeConversation.runs.length > 0 ? (
                <AgentConversationTimeline
                  comments={activeConversation.comments}
                  onFileLinkClick={(path) =>
                    openProjectPath(project?.path, path, platform.openPath)
                  }
                  responseHeader={responseHeader}
                  runs={activeConversation.runs}
                />
              ) : (
                <QuickChatEmptyState />
              )}
              <div ref={feedEndRef} />
            </div>
          </ScrollArea>
          <div className="border-t bg-background/70 p-3 md:p-5">
            <div className="mx-auto max-w-5xl">
              <AgentConversationComposer
                codeSelectionAttachments={draftCodeAttachments}
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
                placeholder="Ask for a focused code change"
                submitLabel="Send"
                title="Message agent"
                toolbarEnd={
                  <div className="w-[28rem] max-w-full min-w-0">
                    <ModelSelector />
                  </div>
                }
              />
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

function QuickChatHistoryPanel({
  activeId,
  conversations,
  onCreate,
  onSelect,
}: {
  activeId: string
  conversations: QuickChatConversation[]
  onCreate: () => void
  onSelect: (id: string) => void
}) {
  return (
    <aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl bg-input/35 shadow-xl ring-1 shadow-black/10 ring-foreground/15 backdrop-blur-xl xl:flex">
      <div className="flex items-center justify-between gap-3 px-4 py-4">
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
          <PlusIcon />
        </Button>
      </div>
      <Separator />
      <ScrollArea className="min-h-0 flex-1">
        <div className="grid gap-2 p-3">
          {conversations.map((conversation) => (
            <QuickChatHistoryItem
              active={conversation.id === activeId}
              conversation={conversation}
              key={conversation.id}
              onSelect={onSelect}
            />
          ))}
        </div>
      </ScrollArea>
    </aside>
  )
}

function QuickChatHistoryItem({
  active,
  conversation,
  onSelect,
}: {
  active: boolean
  conversation: QuickChatConversation
  onSelect: (id: string) => void
}) {
  return (
    <button
      className={cn(
        "grid min-w-0 gap-2 rounded-xl border p-3 text-left text-sm transition-colors",
        active
          ? "border-blue-500/40 bg-blue-500/10"
          : "border-transparent bg-background/45 hover:border-border hover:bg-background/70"
      )}
      onClick={() => onSelect(conversation.id)}
      type="button"
    >
      <span className="flex min-w-0 items-center gap-2">
        <MessageCircleIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate font-medium">{conversation.title}</span>
      </span>
      <span className="line-clamp-2 text-xs leading-snug text-muted-foreground">
        {conversationPreview(conversation)}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock3Icon className="size-3" />
        {relativeTimeLabel(conversation.updatedAt)}
      </span>
    </button>
  )
}

function QuickChatHeader({
  activeId,
  branchName,
  changeCount,
  conversations,
  projectName,
  projectPath,
  onCreate,
  onSelect,
}: {
  activeId: string
  branchName: string
  changeCount?: number
  conversations: QuickChatConversation[]
  projectName: string
  projectPath: string
  onCreate: () => void
  onSelect: (id: string) => void
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
          <PlusIcon />
          New
        </Button>
        {conversations.map((conversation) => (
          <button
            className={cn(
              "h-7 max-w-56 shrink-0 rounded-lg border px-2 text-sm transition-colors",
              conversation.id === activeId
                ? "border-blue-500/40 bg-blue-500/10 text-foreground"
                : "border-border bg-background/60 text-muted-foreground"
            )}
            key={conversation.id}
            onClick={() => onSelect(conversation.id)}
            type="button"
          >
            <span className="block truncate">{conversation.title}</span>
          </button>
        ))}
      </div>
    </header>
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

function readQuickChatState(
  storageKey: string,
  projectName: string | undefined
): QuickChatState {
  const fallback = defaultQuickChatState(projectName)
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "null")
    return normalizeQuickChatState(parsed, fallback)
  } catch {
    return fallback
  }
}

function writeQuickChatState(storageKey: string, state: QuickChatState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(state))
  } catch {
    return
  }
}

function defaultQuickChatState(projectName: string | undefined) {
  const conversation = createEmptyConversation(projectName)
  return {
    activeId: conversation.id,
    conversations: [conversation],
  }
}

function normalizeQuickChatState(
  value: unknown,
  fallback: QuickChatState
): QuickChatState {
  if (!value || typeof value !== "object") return fallback
  const state = value as Partial<QuickChatState>
  const conversations = Array.isArray(state.conversations)
    ? state.conversations.filter(isQuickChatConversation)
    : []
  if (conversations.length === 0) return fallback
  const activeId = conversations.some((item) => item.id === state.activeId)
    ? state.activeId!
    : conversations[0].id
  return { activeId, conversations }
}

function isQuickChatConversation(
  value: unknown
): value is QuickChatConversation {
  if (!value || typeof value !== "object") return false
  const conversation = value as Partial<QuickChatConversation>
  return Boolean(
    typeof conversation.id === "string" &&
    typeof conversation.title === "string" &&
    typeof conversation.createdAt === "string" &&
    typeof conversation.updatedAt === "string" &&
    typeof conversation.storyId === "number" &&
    Array.isArray(conversation.comments) &&
    Array.isArray(conversation.runs)
  )
}

function addQuickChatConversation(
  state: QuickChatState,
  projectName: string | undefined
) {
  const conversation = createEmptyConversation(projectName)
  return {
    activeId: conversation.id,
    conversations: [conversation, ...state.conversations],
  }
}

function createEmptyConversation(projectName: string | undefined) {
  const now = new Date().toISOString()
  return {
    comments: [],
    createdAt: now,
    id: crypto.randomUUID(),
    runs: [],
    storyId: Date.now(),
    title: projectName ? `${projectName} quick change` : "Quick change",
    updatedAt: now,
  }
}

function activeQuickChatConversation(state: QuickChatState) {
  return (
    state.conversations.find(
      (conversation) => conversation.id === state.activeId
    ) ?? state.conversations[0]
  )
}

function updateQuickChatConversation(
  state: QuickChatState,
  id: string,
  update: (conversation: QuickChatConversation) => QuickChatConversation
) {
  return {
    ...state,
    conversations: state.conversations.map((conversation) =>
      conversation.id === id ? update(conversation) : conversation
    ),
  }
}

function createQuickChatComment({
  attachments,
  body,
  codeAttachments,
  conversation,
  now,
}: {
  attachments: UserStoryFileAttachment[]
  body: string
  codeAttachments: PendingCodeSelectionAttachment[]
  conversation: QuickChatConversation
  now: string
}): UserStoryComment {
  return {
    author: "You",
    body,
    codeSelectionAttachments: codeAttachments,
    createdAt: now,
    fileAttachments: attachments,
    id: Date.now(),
    updatedAt: now,
    userStoryId: conversation.storyId,
  }
}

function createQuickChatRun({
  comment,
  conversation,
  modelId,
  now,
  providerId,
}: {
  comment: UserStoryComment
  conversation: QuickChatConversation
  modelId?: string
  now: string
  providerId?: string
}): UserStoryAgentRun & {
  modelId?: string
  providerId?: string
} {
  const response = quickChatPendingResponse()
  return {
    activities: [quickChatResponseActivity(response, now)],
    commentId: comment.id,
    createdAt: now,
    finalResponse: response,
    id: Date.now() + 1,
    kind: "resume",
    modelId,
    providerId,
    status: "completed",
    updatedAt: now,
    userStoryId: conversation.storyId,
  }
}

function quickChatResponseActivity(
  response: string,
  now: string
): UserStoryAgentActivity {
  return {
    createdAt: now,
    detail: response,
    id: crypto.randomUUID(),
    kind: "message",
    messageKind: "final",
    status: "completed",
    title: "Agent response",
    updatedAt: now,
  }
}

function quickChatPendingResponse() {
  return [
    "Ready to work directly in the current project branch.",
    "",
    "Agent execution will plug into this thread next; the request is saved in this quick chat history.",
  ].join("\n")
}

function conversationTitle(
  conversation: QuickChatConversation,
  message: string
) {
  if (conversation.runs.length > 0) return conversation.title
  return shortLabel(message.replace(/[#*_`>[\]()]/g, " ").trim(), 56)
}

function conversationPreview(conversation: QuickChatConversation) {
  const comment = conversation.comments.at(-1)
  if (!comment) return "No messages yet"
  return shortLabel(comment.body || "Attachment only", 96)
}

function shortLabel(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (!normalized) return "Quick change"
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
