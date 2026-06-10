import { PlusIcon } from "lucide-react"

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
        <Button type="button" disabled={disabled} onClick={onCreateUserStory}>
          <PlusIcon />
          New User Story
        </Button>
      </div>
    </div>
  )
}
