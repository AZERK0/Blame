import * as React from "react"
import { AppWindowIcon, BookOpenIcon, CodeIcon, XIcon } from "lucide-react"

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
import { pendingFileAttachments } from "@/components/backlog/drawer/user-story-attachment-files"
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

export function UserStoryDrawerPanel({
  focusComment,
  initialDevelopmentTab,
  initialTab,
  mode,
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
  const [saving, setSaving] = React.useState(false)
  const [title, setTitle] = React.useState(
    mode === "create" ? "" : (userStory?.title ?? "")
  )
  const [summary, setSummary] = React.useState(
    mode === "create" ? "" : (userStory?.summary ?? "")
  )
  const [comment, setComment] = React.useState("")
  const summaryRef = React.useRef<HTMLDivElement>(null)
  const commentRef = React.useRef<HTMLDivElement>(null)

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
    <DrawerContent className="inset-y-2 right-2 h-[calc(100svh-1rem)] overflow-hidden rounded-xl border data-[vaul-drawer-direction=right]:w-[min(90rem,calc(100vw-1rem))] data-[vaul-drawer-direction=right]:sm:max-w-none">
      <DrawerClose asChild>
        <Button
          className="absolute top-4 right-4 z-10"
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
          <span className="sr-only">Close</span>
        </Button>
      </DrawerClose>
      <DrawerHeader className="border-b px-6 py-6 pr-14">
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
      </DrawerHeader>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as UserStoryDrawerTab)}
        className="min-h-0 flex-1 gap-0 overflow-hidden"
      >
        {hasDevelopment && (
          <div className="border-b px-6 py-3">
            <TabsList className="min-w-100">
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
          </div>
        )}
        <TabsContent value="user-story" className="min-h-0 overflow-hidden">
          <DrawerBody status={status} userStory={userStory}>
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
              onCapture={() => {
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
      <DrawerFooter className="border-t bg-popover/95 px-6 py-4">
        <DrawerActions
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
    if (saving) return
    if (action === "Close") return onCancel()
    if (action === "Discard") return discardUserStory()
    setSaving(true)
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
      setSaving(false)
    }
  }

  async function discardUserStory() {
    if (!userStory) return onCancel()
    setSaving(true)
    try {
      await onDeleteUserStory(userStory)
      onCancel()
    } finally {
      setSaving(false)
    }
  }

  function openDevelopmentFile(path: string) {
    setDevelopmentFileTarget({ id: crypto.randomUUID(), path })
    setDevelopmentTab("files")
    setTab("development")
  }

  async function submitComment() {
    if (!userStory) return
    const hasCommentAttachments =
      commentCodeSelectionAttachments.length > 0 ||
      commentFileAttachments.length > 0
    const body =
      comment.trim() || (hasCommentAttachments ? "Attached files." : "")
    if (!body && !hasCommentAttachments) return
    setSaving(true)
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
      setSaving(false)
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
      className="-mx-2 !h-auto rounded-md !border-transparent !bg-transparent px-2 py-1 font-heading !text-3xl leading-tight font-semibold shadow-none hover:!border-input focus-visible:!border-ring focus-visible:!ring-0 md:!text-3xl dark:!bg-transparent"
    />
  )
}

function DrawerBody({
  children,
  status,
  userStory,
}: {
  children: React.ReactNode
  status: BacklogColumnId
  userStory?: UserStory
}) {
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] overflow-hidden">
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-6">
          {children}
        </div>
      </ScrollArea>
      <div className="h-full min-h-0 overflow-hidden border-l bg-muted/20">
        <ScrollArea className="h-full min-h-0">
          <DrawerSidebar status={status} userStory={userStory} />
        </ScrollArea>
      </div>
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
