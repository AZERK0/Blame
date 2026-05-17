import * as React from "react"
import {
  CheckIcon,
  CircleStopIcon,
  FileDiffIcon,
  MessageSquareIcon,
  RotateCcwIcon,
  SendIcon,
  XIcon,
} from "lucide-react"

import type { BacklogColumnId } from "@/components/backlog/data/backlog-data"
import type {
  DrawerAction,
  UserStoryDrawerMode,
} from "@/components/backlog/shared/backlog-types"
import { drawerActions } from "@/components/backlog/drawer/user-story-drawer-helpers"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const drawerActionConfig = {
  Cancel: {
    icon: XIcon,
    variant: "destructive",
  },
  "Save as Draft": {
    icon: CheckIcon,
    variant: "outline",
  },
  "Send to Dev Agent": {
    icon: SendIcon,
    variant: "default",
    tone: "primary",
  },
  "Save Changes": {
    icon: CheckIcon,
    variant: "outline",
  },
  Dequeue: {
    icon: RotateCcwIcon,
    variant: "destructive",
  },
  "Stop Agent": {
    icon: CircleStopIcon,
    variant: "destructive",
  },
  "Request Changes": {
    icon: MessageSquareIcon,
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
  Close: {
    icon: XIcon,
    variant: "outline",
  },
  "Rework as Draft": {
    icon: RotateCcwIcon,
    variant: "default",
    tone: "primary",
  },
} satisfies Record<
  DrawerAction,
  {
    icon: React.ComponentType<{ className?: string }>
    variant: React.ComponentProps<typeof Button>["variant"]
    tone?: "primary" | "info"
  }
>

export function DrawerActions({
  mode,
  onAction,
  onCancel,
  status,
}: {
  mode: UserStoryDrawerMode
  onAction: (action: DrawerAction) => void
  onCancel: () => void
  status: BacklogColumnId
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      {drawerActions(mode, status).map((action) => (
        <DrawerActionButton
          key={action}
          action={action}
          onClick={action === "Cancel" ? onCancel : () => onAction(action)}
        />
      ))}
    </div>
  )
}

function DrawerActionButton({
  action,
  onClick,
}: {
  action: DrawerAction
  onClick?: () => void
}) {
  const actionStyle = drawerActionConfig[action]
  const Icon = actionStyle.icon

  return (
    <Button
      type="button"
      variant={actionStyle.variant}
      className={cn(
        actionStyle.tone === "primary" &&
          "bg-emerald-600 text-white hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500",
        actionStyle.tone === "info" &&
          "border-blue-500/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-300"
      )}
      onClick={onClick}
    >
      <Icon />
      {action}
    </Button>
  )
}
