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

export type StopAgentChoice = "pause-feedback" | "backlog" | "discard-worktree"

export function StopAgentDialog({
  onOpenDrawer,
  onStopAgent,
  story,
}: {
  onOpenDrawer: OpenDrawer
  onStopAgent: (story: UserStory, choice: StopAgentChoice) => Promise<UserStory>
  story: UserStory
}) {
  const [stopping, setStopping] = React.useState<StopAgentChoice>()

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
            loading={stopping === "pause-feedback"}
            onClick={() => {
              void stop("pause-feedback").then((nextStory) => {
                if (!nextStory) return
                onOpenDrawer({
                  userStory: nextStory,
                  mode: "view",
                  initialTab: "user-story",
                  focusComment: true,
                })
              })
            }}
          />
          <StopChoice
            icon={RotateCcwIcon}
            label="Stop & Send Back to Backlog"
            loading={stopping === "backlog"}
            onClick={() => {
              void stop("backlog")
            }}
          />
          <Separator />
          <StopChoice
            icon={Trash2Icon}
            label="Discard Worktree"
            destructive
            loading={stopping === "discard-worktree"}
            onClick={() => {
              void stop("discard-worktree")
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )

  async function stop(choice: StopAgentChoice) {
    if (stopping) return
    setStopping(choice)
    try {
      return await onStopAgent(story, choice)
    } finally {
      setStopping(undefined)
    }
  }
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
  loading,
  onClick,
  destructive,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  loading?: boolean
  onClick?: () => void
  destructive?: boolean
}) {
  return (
    <DialogClose asChild>
      <Button
        type="button"
        disabled={loading}
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
