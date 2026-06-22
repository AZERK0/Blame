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
  hasDevelopmentTab,
  normalizeDevelopmentTab,
} from "@/components/backlog/drawer/user-story-drawer-helpers"
import { DrawerSidebar } from "@/components/backlog/drawer/user-story-drawer-sidebar"
import { UserStoryContent } from "@/components/backlog/drawer/user-story-drawer-sections"
import { UserStoryPreview } from "@/components/backlog/drawer/user-story-preview"
import {
  fileAttachment,
  pendingFileAttachments,
} from "@/components/backlog/drawer/user-story-attachment-files"
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
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const drawerSidebarStorageKey = "blame.app.user-story-drawer-sidebar-open.v1"

export function UserStoryDrawerPanel({
  focusComment,
  initialDevelopmentTab,
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
  onUpdateUserStory,
  setupInitializing,
  status,
  userStory,
}: {
  focusComment?: boolean
  initialDevelopmentTab: UserStoryDevelopmentTab
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
    commentId: number,
    codeSelectionAttachments: UserStoryComment["codeSelectionAttachments"],
    fileAttachments: UserStoryComment["fileAttachments"]
  ) => Promise<UserStory>
  onReject: (story: UserStory, choice: RejectChoice) => Promise<UserStory>
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  onUpdateUserStory: (
    story: UserStory,
    input: UserStoryUpdate
  ) => Promise<UserStory>
  setupInitializing?: boolean
  status: BacklogColumnId
  userStory?: UserStory
}) {
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
      userStory?.codeSelectionAttachments ?? []
    )
  const [summaryFileAttachments, setSummaryFileAttachments] = React.useState<
    UserStoryFileAttachment[]
  >(userStory?.fileAttachments ?? [])
  const [commentCodeSelectionAttachments, setCommentCodeSelectionAttachments] =
    React.useState<PendingCodeSelectionAttachment[]>([])
  const [commentFileAttachments, setCommentFileAttachments] = React.useState<
    UserStoryFileAttachment[]
  >([])
  const [commentEditorKey, setCommentEditorKey] = React.useState(0)
  const [developmentFileTarget, setDevelopmentFileTarget] = React.useState<{
    id: string
    path: string
  }>()
  const [pendingAction, setPendingAction] = React.useState<DrawerAction>()
  const [sidebarOpen, setSidebarOpen] = React.useState(readSidebarOpen)
  const [title, setTitle] = React.useState(
    mode === "create" ? "" : (userStory?.title ?? "")
  )
  const [summary, setSummary] = React.useState(
    mode === "create" ? "" : (userStory?.summary ?? "")
  )
  const [comment, setComment] = React.useState("")
  const summaryRef = React.useRef<HTMLDivElement>(null)
  const commentRef = React.useRef<HTMLDivElement>(null)
  const drawerContentRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    localStorage.setItem(drawerSidebarStorageKey, JSON.stringify(sidebarOpen))
  }, [sidebarOpen])

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
    if (!open || focusComment || tab !== "user-story") return
    const frame = requestAnimationFrame(() => {
      const responses = drawerContentRef.current?.querySelectorAll<HTMLElement>(
        "[data-agent-response]"
      )
      responses?.item(responses.length - 1)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [focusComment, open, tab])

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

  return (
    <DrawerContent
      ref={drawerContentRef}
      className="inset-y-2 right-2 h-[calc(100svh-1rem)] overflow-hidden rounded-xl border data-[vaul-drawer-direction=right]:w-[min(90rem,calc(100vw-1rem))] data-[vaul-drawer-direction=right]:sm:max-w-none"
    >
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
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        <DrawerHeader className="gap-4 px-6 py-6 pr-14">
          <div className="min-w-0 flex-1">
            <DrawerTitle asChild>
              <DrawerHeaderTitle
                mode={mode}
                title={title}
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
          <DrawerBody sidebarOpen={sidebarAvailable && sidebarOpen}>
            <UserStoryContent
              commentCodeSelectionAttachments={commentCodeSelectionAttachments}
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
          <TabsContent value="preview" className="min-h-0 overflow-hidden">
            <UserStoryPreview
              setupInitializing={setupInitializing}
              userStory={userStory}
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
          <TabsContent value="development" className="min-h-0 overflow-hidden">
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
        <DrawerSidebarIsland
          open={sidebarOpen}
          userStory={userStory}
        />
      )}
      <DrawerFooter className="pointer-events-none absolute right-4 bottom-4 z-20 p-0">
        <DrawerActions
          loadingAction={
            pendingAction === "Approve & Merge" ? pendingAction : undefined
          }
          mode={mode}
          status={status}
          onAction={(action) => {
            void handleAction(action)
          }}
          onDeleteUserStory={onDeleteUserStory}
          onOpenDrawer={onOpenDrawer}
          onReject={onReject}
          onStopAgent={onStopAgent}
          story={userStory}
        />
      </DrawerFooter>
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
  userStory,
}: {
  mode: UserStoryDrawerMode
  onTitleChange: (title: string) => void
  title: string
  userStory?: UserStory
}) {
  return (
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
  )
}

function DrawerBody({
  children,
  sidebarOpen,
}: {
  children: React.ReactNode
  sidebarOpen: boolean
}) {
  const contentClassName = sidebarOpen
    ? "mx-auto flex max-w-5xl flex-col gap-6 px-6 pt-6 pb-28 lg:mx-0 lg:mr-[26rem]"
    : "flex w-full flex-col gap-6 px-6 pt-6 pb-28"

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <ScrollArea className="h-full min-h-0">
        <div className={contentClassName}>{children}</div>
      </ScrollArea>
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
    <div className="absolute top-4 right-4 bottom-16 z-10 w-[min(24rem,calc(100%-2rem))] h-fit overflow-hidden rounded-xl bg-input/40 dark:bg-muted shadow-xl shadow-black/10 ring-1 ring-foreground/20 backdrop-blur-xl">
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
    return JSON.parse(
      localStorage.getItem(drawerSidebarStorageKey) ?? "false"
    ) === true
  } catch {
    return false
  }
}
