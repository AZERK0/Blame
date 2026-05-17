import { Code2Icon, PlusIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

export function BacklogToolbar({
  disabled,
  onCreateUserStory,
  storyCount,
}: {
  disabled?: boolean
  onCreateUserStory: () => void
  storyCount: number
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="font-heading text-xl font-semibold tracking-normal">
          Backlog
        </h2>
        <p className="text-sm text-muted-foreground">
          {storyCount} user stories across the delivery pipeline
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2">
          <Code2Icon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">3 agents max</span>
        </div>
        <Button type="button" disabled={disabled} onClick={onCreateUserStory}>
          <PlusIcon />
          New User Story
        </Button>
      </div>
    </div>
  )
}
