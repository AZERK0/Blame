import * as React from "react"
import {
  CheckIcon,
  CircleStopIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitMergeIcon,
  LoaderCircleIcon,
  MessageSquareReplyIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import {
  type BacklogAction,
  type UserStory,
} from "@/components/backlog/data/backlog-data"
import { drawerTargetForAction } from "@/components/backlog/shared/backlog-helpers"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { StopAgentDialog } from "@/components/backlog/actions/story-action-dialogs"
import type { StopAgentChoice } from "@/components/backlog/actions/story-action-dialogs"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type StoryActionHandler = (
  story: UserStory,
  action: BacklogAction
) => Promise<UserStory | void>

type ActionConfig = {
  icon: React.ComponentType<{ className?: string }>
  variant: React.ComponentProps<typeof Button>["variant"]
  tone?: "primary" | "preview"
  compact?: boolean
  iconOnly?: boolean
}

const actionConfig: Record<BacklogAction, ActionConfig> = {
  "Send to Dev Agent": {
    icon: SendIcon,
    variant: "default",
    tone: "primary",
    compact: true,
  },
  Discard: {
    icon: XIcon,
    variant: "destructive",
    compact: true,
    iconOnly: true,
  },
  Dequeue: {
    icon: RotateCcwIcon,
    variant: "destructive",
    compact: true,
  },
  "Open Worktree": {
    icon: FolderOpenIcon,
    variant: "outline",
  },
  "Open Preview": {
    icon: ExternalLinkIcon,
    variant: "outline",
    tone: "preview",
  },
  "Stop Agent": {
    icon: CircleStopIcon,
    variant: "destructive",
  },
  "Unpause Agent": {
    icon: PlayIcon,
    variant: "default",
    tone: "primary",
  },
  "View Diff": {
    icon: GitMergeIcon,
    variant: "outline",
  },
  "View Files": {
    icon: FileTextIcon,
    variant: "outline",
  },
  "View Terminal": {
    icon: TerminalIcon,
    variant: "outline",
  },
  "Request Changes": {
    icon: MessageSquareReplyIcon,
    variant: "outline",
  },
  Reject: {
    icon: XIcon,
    variant: "destructive",
  },
  "Approve & Merge": {
    icon: CheckIcon,
    variant: "default",
    tone: "primary",
  },
  Rework: {
    icon: RotateCcwIcon,
    variant: "default",
    tone: "primary",
    compact: true,
  },
  "Delete Permanently": {
    icon: Trash2Icon,
    variant: "destructive",
    compact: true,
  },
}

export function StoryAction({
  action,
  className,
  label,
  onAction,
  onOpenDrawer,
  onOpenWorktree,
  onStopAgent,
  onUnpauseAgent,
  story,
}: {
  action: BacklogAction
  className?: string
  label?: string
  onAction?: StoryActionHandler
  onOpenDrawer: OpenDrawer
  onOpenWorktree?: (story: UserStory) => Promise<void>
  onStopAgent?: (
    story: UserStory,
    choice: StopAgentChoice
  ) => Promise<UserStory>
  onUnpauseAgent?: (story: UserStory) => Promise<UserStory>
  story: UserStory
}) {
  const [loading, setLoading] = React.useState(false)

  if (action === "Stop Agent") {
    if (!onStopAgent) return null
    return (
      <StopAgentDialog
        onOpenDrawer={onOpenDrawer}
        onStopAgent={onStopAgent}
        story={story}
      />
    )
  }
  if (action === "Unpause Agent") {
    if (!onUnpauseAgent) return null
    const actionStyle = actionConfig[action]
    const Icon = actionStyle.icon
    return (
      <Button
        type="button"
        size="sm"
        variant={actionStyle.variant}
        className={cn(
          "justify-start",
          "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
          className
        )}
        onClick={() => void onUnpauseAgent(story)}
      >
        <Icon />
        {label ?? action}
      </Button>
    )
  }
  if (action === "Open Worktree") {
    const actionStyle = actionConfig[action]
    const Icon = actionStyle.icon
    return (
      <Button
        type="button"
        size="sm"
        variant={actionStyle.variant}
        className={cn("justify-start", "w-full", className)}
        onClick={() => void onOpenWorktree?.(story)}
      >
        <Icon />
        {label ?? action}
      </Button>
    )
  }

  const actionStyle = actionConfig[action]
  const Icon = loading ? LoaderCircleIcon : actionStyle.icon
  const runAction = directAction(action) && onAction
  const handleClick = async () => {
    if (!runAction) {
      onOpenDrawer(drawerTargetForAction(story, action))
      return
    }
    if (action !== "Approve & Merge") {
      await runAction(story, action)
      return
    }
    setLoading(true)
    try {
      await runAction(story, action)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button
      type="button"
      disabled={loading}
      size={actionStyle.iconOnly ? "icon-sm" : "sm"}
      variant={actionStyle.variant}
      className={cn(
        "justify-start",
        actionStyle.iconOnly && "justify-center",
        !actionStyle.compact && "w-full",
        actionStyle.tone === "primary" &&
          "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
        actionStyle.tone === "preview" &&
          "border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300",
        className
      )}
      onClick={() => void handleClick()}
      aria-label={actionStyle.iconOnly ? action : undefined}
    >
      <Icon className={cn(loading && "animate-spin")} />
      {!actionStyle.iconOnly && (label ?? action)}
    </Button>
  )
}

function directAction(action: BacklogAction) {
  return (
    action === "Send to Dev Agent" ||
    action === "Discard" ||
    action === "Dequeue" ||
    action === "Approve & Merge" ||
    action === "Rework"
  )
}
