import * as React from "react"
import {
  AppWindowIcon,
  BookOpenIcon,
  CodeIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  XIcon,
} from "lucide-react"

import type {
  BacklogColumnId,
  UserStory,
  UserStoryComment,
  UserStoryDraft,
  UserStoryFileAttachment,
  UserStoryUpdate,
} from "@/components/backlog/data/backlog-data"
import type {
  RejectChoice,
  StopAgentChoice,
} from "@/components/backlog/actions/story-action-dialogs"
import { ColumnStatusBadge } from "@/components/backlog/shared/backlog-status-badge"
import { UserStoryTitleCloud } from "@/components/backlog/shared/user-story-title-cloud"
import type {
  DrawerAction,
  OpenDrawer,
  UserStoryDevelopmentTab,
  UserStoryDrawerMode,
  UserStoryDrawerTab,
} from "@/components/backlog/shared/backlog-types"
import { DevelopmentContent } from "@/components/backlog/drawer/user-story-development"
import { DrawerActions } from "@/components/backlog/drawer/user-story-drawer-actions"
import {
  drawerActions,
  hasDevelopmentTab,
  normalizeDevelopmentTab,
} from "@/components/backlog/drawer/user-story-drawer-helpers"
import { DrawerSidebar } from "@/components/backlog/drawer/user-story-drawer-sidebar"
import {
  UserStoryContent,
  UserStoryFixedSection,
} from "@/components/backlog/drawer/user-story-drawer-sections"
import type { AgentConversationUserMessageUndo } from "@/components/chat/agent-conversation"
import { UserStoryPreview } from "@/components/backlog/drawer/user-story-preview"
import {
  fileAttachment,
  pendingFileAttachments,
} from "@/components/backlog/drawer/user-story-attachment-files"
import {
  composerDraftStorageKey,
  readComposerDraft,
  removeComposerDraft,
  writeComposerDraft,
} from "@/components/backlog/drawer/composer-draft-storage"
import {
  codeSelectionAttachmentEvent,
  type CodeSelectionAttachment,
  type PendingCodeSelectionAttachment,
} from "@/components/backlog/shared/comment-attachment-events"
import { Button } from "@/components/ui/button"
import {
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

const drawerSidebarStorageKey = "blame.app.user-story-drawer-sidebar-open.v1"
const drawerHeaderSoftBlurMask = {
  maskImage:
    "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
  WebkitMaskImage:
    "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
} satisfies React.CSSProperties
const drawerHeaderStrongBlurMask = {
  maskImage: "linear-gradient(to bottom, black 0%, transparent 72%)",
  WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 72%)",
} satisfies React.CSSProperties

export function UserStoryDrawerPanel({
  focusComment,
  initialDevelopmentTab,
  initialDraft,
  initialTab,
  mode,
  open,
  onCancel,
  onApproveAndMerge,
  onCreateUserStory,
  onCreateUserStoryComment,
  onDeleteUserStory,
  onOpenDrawer,
  onOptimizeUserStory,
  onRequestChanges,
  onReject,
  onStopAgent,
  onUndoUserStoryComment,
  onUpdateUserStory,
  reviewDiffEmpty,
  setupInitializing,
  status,
  titleGenerating,
  userStory,
}: {
  focusComment?: boolean
  initialDevelopmentTab: UserStoryDevelopmentTab
  initialDraft?: Partial<Omit<UserStoryDraft, "projectId">>
  initialTab: UserStoryDrawerTab
  mode: UserStoryDrawerMode
  open: boolean
  onCancel: () => void
  onApproveAndMerge: (story: UserStory) => Promise<UserStory>
  onCreateUserStory: (
    input: Omit<UserStoryDraft, "projectId">
  ) => Promise<UserStory>
  onCreateUserStoryComment: (
    story: UserStory,
    input: Pick<
      UserStoryComment,
      "body" | "codeSelectionAttachments" | "fileAttachments"
    >
  ) => Promise<UserStoryComment>
  onDeleteUserStory: (story: UserStory) => Promise<void>
  onOpenDrawer: OpenDrawer
  onOptimizeUserStory?: (input: {
    summary: string
    title: string
  }) => Promise<string>
  onRequestChanges: (
    story: UserStory,
    feedback: string,
    commentId: string,
    codeSelectionAttachments: UserStoryComment["codeSelectionAttachments"],
    fileAttachments: UserStoryComment["fileAttachments"]
  ) => Promise<UserStory>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUndoUserStoryComment: (
    story: UserStory,
    target: AgentConversationUserMessageUndo
  ) => Promise<UserStory>
  onUpdateUserStory: (
    story: UserStory,
    input: UserStoryUpdate
  ) => Promise<UserStory>
  reviewDiffEmpty?: boolean
  setupInitializing?: boolean
  status: BacklogColumnId
  titleGenerating?: boolean
  userStory?: UserStory
}) {
  const draftStorageKey = composerDraftStorageKey(
    userStory?.projectId ?? initialDraft?.projectId ?? "project",
    "backlog",
    userStory?.id
  )
  const storedDraft = React.useMemo(
    () => readComposerDraft(localStorage, draftStorageKey),
    [draftStorageKey]
  )
  const hasDevelopment = hasDevelopmentTab(status)
  const hasPreview = status === "in-progress" || status === "in-review"
  const sidebarAvailable = Boolean(
    mode !== "create" && (userStory?.clineSessionId || userStory?.agentUsage)
  )
  const [tab, setTab] = React.useState<UserStoryDrawerTab>(
    initialDrawerTab(hasDevelopment, hasPreview, focusComment, initialTab)
  )
  const [developmentTab, setDevelopmentTab] =
    React.useState<UserStoryDevelopmentTab>(
      normalizeDevelopmentTab(status, initialDevelopmentTab)
    )
  const [summaryCodeSelectionAttachments, setSummaryCodeSelectionAttachments] =
    React.useState<PendingCodeSelectionAttachment[]>(
      mode === "create"
        ? (storedDraft?.codeSelectionAttachments ??
            initialDraft?.codeSelectionAttachments ??
            [])
        : (userStory?.codeSelectionAttachments ?? [])
    )
  const [summaryFileAttachments, setSummaryFileAttachments] = React.useState<
    UserStoryFileAttachment[]
  >(
    mode === "create"
      ? (storedDraft?.fileAttachments ?? initialDraft?.fileAttachments ?? [])
      : (userStory?.fileAttachments ?? [])
  )
  const [commentCodeSelectionAttachments, setCommentCodeSelectionAttachments] =
    React.useState<PendingCodeSelectionAttachment[]>(
      mode === "create" ? [] : (storedDraft?.codeSelectionAttachments ?? [])
    )
  const [commentFileAttachments, setCommentFileAttachments] = React.useState<
    UserStoryFileAttachment[]
  >(mode === "create" ? [] : (storedDraft?.fileAttachments ?? []))
  const [commentEditorKey, setCommentEditorKey] = React.useState(0)
  const [developmentFileTarget, setDevelopmentFileTarget] = React.useState<{
    id: string
    path: string
  }>()
  const [pendingAction, setPendingAction] = React.useState<DrawerAction>()
  const [sidebarOpen, setSidebarOpen] = React.useState(readSidebarOpen)
  const [title, setTitle] = React.useState(
    mode === "create" ? (initialDraft?.title ?? "") : (userStory?.title ?? "")
  )
  const [summary, setSummary] = React.useState(
    mode === "create"
      ? (storedDraft?.markdown ?? initialDraft?.summary ?? "")
      : (userStory?.summary ?? "")
  )
  const [comment, setComment] = React.useState(
    mode === "create" ? "" : (storedDraft?.markdown ?? "")
  )
  const summaryRef = React.useRef<HTMLDivElement>(null)
  const commentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    localStorage.setItem(drawerSidebarStorageKey, JSON.stringify(sidebarOpen))
  }, [sidebarOpen])

  React.useEffect(() => {
    writeComposerDraft(localStorage, draftStorageKey, {
      markdown: mode === "create" ? summary : comment,
      codeSelectionAttachments:
        mode === "create"
          ? summaryCodeSelectionAttachments
          : commentCodeSelectionAttachments,
      fileAttachments:
        mode === "create" ? summaryFileAttachments : commentFileAttachments,
    })
  }, [
    comment,
    commentCodeSelectionAttachments,
    commentFileAttachments,
    draftStorageKey,
    mode,
    summary,
    summaryCodeSelectionAttachments,
    summaryFileAttachments,
  ])

  React.useEffect(() => {
    if (!focusComment) return
    const frame = requestAnimationFrame(() => {
      commentRef.current
        ?.querySelector<HTMLElement>("[data-markdown-editor-input='true']")
        ?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [focusComment])

  React.useEffect(() => {
    if (mode === "create") return
    if (!titleGenerating) return
    setTitle(userStory?.title ?? "")
  }, [mode, titleGenerating, userStory?.title])

  React.useEffect(() => {
    if (mode === "create") return
    const frame = requestAnimationFrame(() => {
      setSummaryCodeSelectionAttachments((current) =>
        mergeAttachments(current, userStory?.codeSelectionAttachments ?? [])
      )
      setSummaryFileAttachments((current) =>
        mergeAttachments(current, userStory?.fileAttachments ?? [])
      )
    })
    return () => cancelAnimationFrame(frame)
  }, [mode, userStory?.codeSelectionAttachments, userStory?.fileAttachments])

  React.useEffect(() => {
    const sendToDevAgentAvailable = drawerActions(mode, status).includes(
      "Send to Dev Agent"
    )
    if (!open || !sendToDevAgentAvailable) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isSendToDevAgentShortcut(event)) return
      event.preventDefault()
      void handleAction("Send to Dev Agent")
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  })

  React.useEffect(() => {
    const addCodeSelectionAttachment = (event: Event) => {
      const targetSummary = status === "backlog" || status === "ready"
      const updateAttachments = targetSummary
        ? setSummaryCodeSelectionAttachments
        : setCommentCodeSelectionAttachments
      const targetRef = targetSummary ? summaryRef : commentRef
      setTab("user-story")
      updateAttachments((current) => [
        ...current,
        {
          ...(event as CustomEvent<CodeSelectionAttachment>).detail,
          id: crypto.randomUUID(),
        },
      ])
      requestAnimationFrame(() => {
        targetRef.current
          ?.querySelector<HTMLElement>("[data-markdown-editor-input='true']")
          ?.focus()
      })
    }
    window.addEventListener(
      codeSelectionAttachmentEvent,
      addCodeSelectionAttachment
    )
    return () => {
      window.removeEventListener(
        codeSelectionAttachmentEvent,
        addCodeSelectionAttachment
      )
    }
  }, [status])

  const drawerActionButtons = (
    <DrawerActions
      loadingAction={pendingAction}
      mode={mode}
      status={status}
      onAction={(action) => {
        void handleAction(action)
      }}
      onDeleteUserStory={onDeleteUserStory}
      onOpenDrawer={onOpenDrawer}
      onReject={onReject}
      reviewDiffEmpty={reviewDiffEmpty}
      onStopAgent={onStopAgent}
      story={userStory}
    />
  )

  return (
    <DrawerContent className="inset-y-2 right-2 h-[calc(100svh-1rem)] overflow-hidden rounded-xl border bg-[oklch(1_0_0)] text-foreground data-[vaul-drawer-direction=right]:w-[min(90rem,calc(100vw-1rem))] data-[vaul-drawer-direction=right]:sm:max-w-none dark:bg-[oklch(0.16_0_0)]">
      {tab === "user-story" && sidebarAvailable && (
        <Button
          type="button"
          className="absolute top-6 right-16 z-30 border bg-background/90 shadow-sm"
          size="icon-sm"
          variant="outline"
          onClick={() => setSidebarOpen((open) => !open)}
          aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
        >
          {sidebarOpen ? <PanelRightCloseIcon /> : <PanelRightOpenIcon />}
        </Button>
      )}
      <DrawerClose asChild>
        <Button
          className="absolute top-6 right-6 z-30 border bg-background/90 shadow-sm"
          size="icon-sm"
          variant="outline"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      </DrawerClose>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as UserStoryDrawerTab)}
        className="relative min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <DrawerHeader
          className={cn(
            "absolute top-0 right-0 left-0 isolate z-[15] gap-4 overflow-hidden px-6 pt-6 pr-14 pb-6",
            tab === "user-story" &&
              sidebarAvailable &&
              sidebarOpen &&
              "lg:mr-[26rem]"
          )}
        >
          <div
            className="absolute inset-0 -z-10 bg-popover/20 backdrop-blur-sm"
            style={drawerHeaderSoftBlurMask}
          />
          <div
            className="absolute inset-0 -z-10 bg-popover/20 backdrop-blur-2xl backdrop-saturate-150"
            style={drawerHeaderStrongBlurMask}
          />
          <div className="min-w-0 flex-1">
            <DrawerTitle asChild>
              <DrawerHeaderTitle
                mode={mode}
                title={title}
                titleGenerating={titleGenerating}
                userStory={userStory}
                onTitleChange={setTitle}
              />
            </DrawerTitle>
            <DrawerDescription asChild>
              <div className="flex flex-wrap items-center gap-2">
                <ColumnStatusBadge status={status} />
                <span>{userStory?.owner ?? "Product"} created this</span>
                <span>{createdAtLabel(userStory)}</span>
              </div>
            </DrawerDescription>
          </div>
          {hasDevelopment && (
            <TabsList className="mt-2 min-w-100">
              <TabsTrigger value="user-story">
                <BookOpenIcon />
                User Story
              </TabsTrigger>
              {hasPreview && (
                <TabsTrigger value="preview">
                  <AppWindowIcon />
                  Preview
                </TabsTrigger>
              )}
              <TabsTrigger value="development">
                <CodeIcon />
                Code
              </TabsTrigger>
            </TabsList>
          )}
        </DrawerHeader>
        <TabsContent value="user-story" className="min-h-0 overflow-hidden">
          <DrawerBody
            messageButtonClassName={
              mode === "create" ? "bottom-32" : "bottom-72"
            }
            resetKey={userStory?.id ?? mode}
            fixedSection={
              <UserStoryFixedSection
                actions={drawerActionButtons}
                commentCodeSelectionAttachments={
                  commentCodeSelectionAttachments
                }
                commentFileAttachments={pendingFileAttachments(
                  commentFileAttachments
                )}
                comment={comment}
                commentEditorKey={commentEditorKey}
                commentRef={commentRef}
                mode={mode}
                onCommentChange={setComment}
                onCommentCodeSelectionAttachmentRemove={(id) =>
                  setCommentCodeSelectionAttachments((current) =>
                    current.filter((attachment) => attachment.id !== id)
                  )
                }
                onCommentFileAttachmentRemove={(id) =>
                  setCommentFileAttachments((current) =>
                    current.filter((attachment) => attachment.id !== id)
                  )
                }
                onCommentFileAttachmentsAdd={(attachments) =>
                  setCommentFileAttachments((current) => [
                    ...current,
                    ...attachments,
                  ])
                }
                onCommentSubmit={() => {
                  void submitComment()
                }}
                onFileLinkClick={openDevelopmentFile}
                status={status}
                userStory={userStory}
              />
            }
            headerTabsVisible={hasDevelopment}
            sidebarOpen={sidebarAvailable && sidebarOpen}
          >
            <UserStoryContent
              mode={mode}
              onCommentUndo={undoCommentMessage}
              onSummaryCodeSelectionAttachmentRemove={(id) =>
                setSummaryCodeSelectionAttachments((current) =>
                  current.filter((attachment) => attachment.id !== id)
                )
              }
              onSummaryFileAttachmentRemove={(id) =>
                setSummaryFileAttachments((current) =>
                  current.filter((attachment) => attachment.id !== id)
                )
              }
              onSummaryFileAttachmentsAdd={(attachments) =>
                setSummaryFileAttachments((current) => [
                  ...current,
                  ...attachments,
                ])
              }
              onSummaryChange={setSummary}
              onSummaryOptimize={
                onOptimizeUserStory
                  ? (nextSummary) =>
                      onOptimizeUserStory({ summary: nextSummary, title })
                  : undefined
              }
              onFileLinkClick={openDevelopmentFile}
              status={status}
              summary={summary}
              summaryCodeSelectionAttachments={summaryCodeSelectionAttachments}
              summaryFileAttachments={pendingFileAttachments(
                summaryFileAttachments
              )}
              summaryRef={summaryRef}
              userStory={userStory}
            />
          </DrawerBody>
        </TabsContent>
        {hasPreview && (
          <TabsContent
            forceMount
            value="preview"
            className={cn(
              "min-h-0 overflow-hidden",
              tab !== "preview" && "hidden",
              hasDevelopment ? "pt-36" : "pt-28"
            )}
          >
            <UserStoryPreview
              setupInitializing={setupInitializing}
              userStory={userStory}
              visible={tab === "preview"}
              onRunConfigurationChange={(runConfigurationId, previewUrl) => {
                if (!userStory) return
                void onUpdateUserStory(userStory, {
                  previewUrl: previewUrl ?? null,
                  runConfigurationId,
                })
              }}
              onCapture={(file) => {
                void addPreviewCaptureAttachment(file)
                setTab("user-story")
                requestAnimationFrame(() => {
                  commentRef.current
                    ?.querySelector<HTMLElement>(
                      "[data-markdown-editor-input='true']"
                    )
                    ?.focus()
                })
              }}
            />
          </TabsContent>
        )}
        {hasDevelopment && (
          <TabsContent
            value="development"
            className="min-h-0 overflow-hidden pt-36"
          >
            <DevelopmentContent
              key={developmentFileTarget?.id ?? "development"}
              initialFilePath={developmentFileTarget?.path}
              status={status}
              tab={developmentTab}
              userStory={userStory}
              onTabChange={setDevelopmentTab}
            />
          </TabsContent>
        )}
      </Tabs>
      {tab === "user-story" && sidebarAvailable && (
        <DrawerSidebarIsland open={sidebarOpen} userStory={userStory} />
      )}
      {tab !== "user-story" && (
        <div className="pointer-events-none absolute right-4 bottom-4 z-20 p-0">
          {drawerActionButtons}
        </div>
      )}
    </DrawerContent>
  )

  async function handleAction(action: DrawerAction) {
    if (pendingAction) return
    if (action === "Close") return onCancel()
    if (action === "Discard") return discardUserStory()
    setPendingAction(action)
    try {
      if (mode === "create") {
        await onCreateUserStory(
          createInput(
            action,
            title,
            summary,
            summaryCodeSelectionAttachments,
            summaryFileAttachments
          )
        )
        removeComposerDraft(localStorage, draftStorageKey)
      }
      if (mode !== "create" && userStory) {
        if (action === "Approve & Merge") {
          await onApproveAndMerge(userStory)
        } else if (action === "Request Changes") {
          await submitComment()
          return
        } else {
          await onUpdateUserStory(
            userStory,
            actionInput(
              action,
              title,
              summary,
              summaryCodeSelectionAttachments,
              summaryFileAttachments
            )
          )
        }
      }
      if (action !== "Save Changes" && action !== "Save as Draft") onCancel()
    } finally {
      setPendingAction(undefined)
    }
  }

  async function discardUserStory() {
    if (!userStory) return onCancel()
    setPendingAction("Discard")
    try {
      await onDeleteUserStory(userStory)
      onCancel()
    } finally {
      setPendingAction(undefined)
    }
  }

  function openDevelopmentFile(path: string) {
    setDevelopmentFileTarget({ id: crypto.randomUUID(), path })
    setDevelopmentTab("files")
    setTab("development")
  }

  async function addPreviewCaptureAttachment(file: File) {
    const attachment = await fileAttachment(file)
    setCommentFileAttachments((current) => [...current, attachment])
  }

  async function submitComment() {
    if (!userStory) return
    const hasCommentAttachments =
      commentCodeSelectionAttachments.length > 0 ||
      commentFileAttachments.length > 0
    const body =
      comment.trim() || (hasCommentAttachments ? "Attached files." : "")
    if (!body && !hasCommentAttachments) return
    setPendingAction("Request Changes")
    try {
      const createdComment = await onCreateUserStoryComment(userStory, {
        body,
        codeSelectionAttachments: commentCodeSelectionAttachments,
        fileAttachments: commentFileAttachments,
      })
      removeComposerDraft(localStorage, draftStorageKey)
      setComment("")
      setCommentCodeSelectionAttachments([])
      setCommentFileAttachments([])
      setCommentEditorKey((key) => key + 1)
      if (status === "in-review") {
        const nextStory = await onRequestChanges(
          userStory,
          body,
          createdComment.id,
          createdComment.codeSelectionAttachments,
          createdComment.fileAttachments
        )
        if (nextStory.status === "in-progress") onCancel()
      }
    } finally {
      setPendingAction(undefined)
    }
  }

  async function undoCommentMessage(target: AgentConversationUserMessageUndo) {
    if (!userStory) return
    const comment = target.comment
    await onUndoUserStoryComment(userStory, target)
    setComment(comment.body)
    setCommentCodeSelectionAttachments(comment.codeSelectionAttachments ?? [])
    setCommentFileAttachments(comment.fileAttachments ?? [])
    setCommentEditorKey((key) => key + 1)
    setTab("user-story")
    requestAnimationFrame(() => {
      commentRef.current
        ?.querySelector<HTMLElement>("[data-markdown-editor-input='true']")
        ?.focus()
    })
  }
}

function initialDrawerTab(
  hasDevelopment: boolean,
  hasPreview: boolean,
  focusComment: boolean | undefined,
  initialTab: UserStoryDrawerTab
) {
  if (focusComment || !hasDevelopment) return "user-story"
  if (initialTab === "preview" && !hasPreview) return "user-story"
  return initialTab
}

function DrawerHeaderTitle({
  mode,
  onTitleChange,
  title,
  titleGenerating,
  userStory,
}: {
  mode: UserStoryDrawerMode
  onTitleChange: (title: string) => void
  title: string
  titleGenerating?: boolean
  userStory?: UserStory
}) {
  return (
    <UserStoryTitleCloud active={titleGenerating} className="block w-full">
      <Input
        value={title}
        onChange={(event) => onTitleChange(event.currentTarget.value)}
        placeholder="User story title"
        readOnly={
          mode !== "create" &&
          userStory?.status !== "backlog" &&
          userStory?.status !== "discarded"
        }
        className="-mx-2 !h-auto rounded-md !border-transparent !bg-transparent px-2 py-1 font-heading !text-3xl leading-tight font-semibold shadow-none hover:!border-transparent focus:!border-transparent focus-visible:!border-transparent focus-visible:!ring-0 active:!border-transparent md:!text-3xl dark:!bg-transparent"
      />
    </UserStoryTitleCloud>
  )
}

function DrawerBody({
  children,
  fixedSection,
  headerTabsVisible,
  messageButtonClassName,
  resetKey,
  sidebarOpen,
}: {
  children: React.ReactNode
  fixedSection?: React.ReactNode
  headerTabsVisible: boolean
  messageButtonClassName: string
  resetKey: string
  sidebarOpen: boolean
}) {
  const topPaddingClassName = headerTabsVisible ? "pt-36" : "pt-28"
  const contentClassName = sidebarOpen
    ? cn(
        "mx-auto flex max-w-5xl flex-col gap-6 px-6 pb-28 lg:mx-0 lg:mr-[26rem]",
        topPaddingClassName
      )
    : cn("flex w-full flex-col gap-6 px-6 pb-28", topPaddingClassName)
  const fixedSectionClassName = sidebarOpen
    ? "pointer-events-none absolute right-0 bottom-0 left-0 z-20 lg:right-[26rem]"
    : "pointer-events-none absolute right-0 bottom-0 left-0 z-20"
  const fixedSectionContentClassName = "w-full px-6"

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <MessageScrollerProvider key={resetKey}>
        <MessageScroller className="h-full">
          <MessageScrollerViewport aria-label="User story details">
            <MessageScrollerContent className={contentClassName} role="group">
              {children}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton
            className={cn("right-6 z-30", messageButtonClassName)}
          />
        </MessageScroller>
      </MessageScrollerProvider>
      {fixedSection ? (
        <div className={fixedSectionClassName}>
          <div className={fixedSectionContentClassName}>{fixedSection}</div>
        </div>
      ) : null}
    </div>
  )
}

function DrawerSidebarIsland({
  open,
  userStory,
}: {
  open: boolean
  userStory?: UserStory
}) {
  if (!open) return null

  return (
    <div className="absolute top-4 right-4 bottom-16 z-20 h-fit w-[min(24rem,calc(100%-2rem))] overflow-hidden rounded-xl bg-input/40 shadow-xl ring-1 shadow-black/10 ring-foreground/20 backdrop-blur-xl dark:bg-muted">
      <ScrollArea className="h-full min-h-0">
        <DrawerSidebar userStory={userStory} />
      </ScrollArea>
    </div>
  )
}

function createInput(
  action: DrawerAction,
  title: string,
  summary: string,
  codeSelectionAttachments: PendingCodeSelectionAttachment[],
  fileAttachments: UserStoryFileAttachment[] = []
): Omit<UserStoryDraft, "projectId"> {
  return {
    codeSelectionAttachments,
    fileAttachments,
    status: action === "Send to Dev Agent" ? "ready" : "backlog",
    summary,
    title: title.trim() || "Untitled user story",
  }
}

function actionInput(
  action: DrawerAction,
  title: string,
  summary: string,
  codeSelectionAttachments: PendingCodeSelectionAttachment[],
  fileAttachments: UserStoryFileAttachment[]
): UserStoryUpdate {
  const base = {
    codeSelectionAttachments,
    fileAttachments,
    summary,
    title: title.trim() || "Untitled user story",
  }
  if (action === "Send to Dev Agent") return { ...base, status: "ready" }
  if (action === "Dequeue") return { status: "backlog" }
  if (action === "Stop Agent")
    return {
      agentStatus: null,
      discardedReason: "Stopped by user",
      status: "discarded",
    }
  if (action === "Request Changes")
    return { agentStatus: "Running", status: "in-progress" }
  if (action === "Reject")
    return { discardedReason: "Rejected during review", status: "discarded" }
  if (action === "Rework as Draft")
    return { discardedReason: null, status: "backlog" }
  return base
}

function createdAtLabel(userStory?: UserStory) {
  if (!userStory?.createdAt) return "New draft"
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(userStory.createdAt))
}

function readSidebarOpen() {
  try {
    return (
      JSON.parse(localStorage.getItem(drawerSidebarStorageKey) ?? "false") ===
      true
    )
  } catch {
    return false
  }
}

function isSendToDevAgentShortcut(event: KeyboardEvent) {
  return (
    event.key === "Enter" &&
    !event.repeat &&
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey)
  )
}

function mergeAttachments<T extends { id: string }>(current: T[], loaded: T[]) {
  const loadedIds = new Set(loaded.map((attachment) => attachment.id))
  const missing = loaded.filter(
    (attachment) => !current.some((item) => item.id === attachment.id)
  )
  if (!missing.length && current.every((item) => loadedIds.has(item.id))) {
    return current
  }
  return [...missing, ...current]
}
