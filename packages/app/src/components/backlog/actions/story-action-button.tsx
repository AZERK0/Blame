import * as React from "react"
import {
  CheckIcon,
  CircleStopIcon,
  ExternalLinkIcon,
  FileTextIcon,
  FolderOpenIcon,
  GitMergeIcon,
  ListRestartIcon,
  MessageSquareReplyIcon,
  RotateCcwIcon,
  SendIcon, TerminalIcon,
  XIcon,
} from "lucide-react"

import {
  type BacklogAction,
  type UserStory,
} from "@/components/backlog/data/backlog-data"
import { drawerTargetForAction } from "@/components/backlog/shared/backlog-helpers"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { StopAgentDialog } from "@/components/backlog/actions/story-action-dialogs"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ActionConfig = {
  icon: React.ComponentType<{ className?: string }>
  variant: React.ComponentProps<typeof Button>["variant"]
  tone?: "primary" | "preview"
  compact?: boolean
}

const actionConfig = {
  "Send to Dev Agent": {
    icon: SendIcon,
    variant: "default",
    tone: "primary",
    compact: true,
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
    icon: ListRestartIcon,
    variant: "default",
    tone: "primary",
    compact: true,
  },
} satisfies Record<BacklogAction, ActionConfig>

export function StoryAction({
  action,
  className,
  label,
  onOpenDrawer,
  story,
}: {
  action: BacklogAction
  className?: string
  label?: string
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  if (action === "Stop Agent") {
    return <StopAgentDialog onOpenDrawer={onOpenDrawer} story={story} />
  }

  const actionStyle = actionConfig[action]
  const Icon = actionStyle.icon

  return (
    <Button
      type="button"
      size="sm"
      variant={actionStyle.variant}
      className={cn(
        "justify-start",
        !actionStyle.compact && "w-full",
        actionStyle.tone === "primary" &&
          "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
        actionStyle.tone === "preview" &&
          "border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300",
        className
      )}
      onClick={() => onOpenDrawer(drawerTargetForAction(story, action))}
    >
      <Icon />
      {label ?? action}
    </Button>
  )
}
