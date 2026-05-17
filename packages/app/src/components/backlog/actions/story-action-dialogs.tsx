import * as React from "react"
import {
  CircleStopIcon,
  MessageSquareReplyIcon,
  PauseIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import type { OpenDrawer } from "@/components/backlog/shared/backlog-types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"

export function StopAgentDialog({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="justify-start"
        >
          <CircleStopIcon />
          Stop Agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Stop Agent</DialogTitle>
          <DialogDescription>
            Choose how this in-progress user story should continue.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <StopChoice
            icon={PauseIcon}
            label="Pause & Give Feedback"
            onClick={() =>
              onOpenDrawer({
                userStory: story,
                mode: "view",
                initialTab: "user-story",
                focusComment: true,
              })
            }
          />
          <StopChoice
            icon={RotateCcwIcon}
            label="Stop & Send Back to Backlog"
          />
          <Separator />
          <StopChoice icon={Trash2Icon} label="Discard Worktree" destructive />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function RejectDialog({
  onOpenDrawer,
  story,
}: {
  onOpenDrawer: OpenDrawer
  story: UserStory
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          className="w-full justify-start"
        >
          <XIcon />
          Reject
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject User Story</DialogTitle>
          <DialogDescription>
            Choose whether the agent should continue or the user story should be
            discarded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <StopChoice
            icon={MessageSquareReplyIcon}
            label="Request Changes"
            onClick={() =>
              onOpenDrawer({
                userStory: story,
                mode: "view",
                initialTab: "user-story",
                focusComment: true,
              })
            }
          />
          <StopChoice
            icon={Trash2Icon}
            label="Discard User Story"
            destructive
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StopChoice({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  destructive?: boolean
}) {
  return (
    <DialogClose asChild>
      <Button
        type="button"
        variant={destructive ? "destructive" : "outline"}
        className="justify-start"
        onClick={onClick}
      >
        <Icon />
        {label}
      </Button>
    </DialogClose>
  )
}
