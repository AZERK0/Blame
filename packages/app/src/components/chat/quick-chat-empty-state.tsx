import { WrenchIcon } from "lucide-react"

export function QuickChatEmptyState() {
  return (
    <div className="grid place-items-center pb-6">
      <div className="grid max-w-md justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-full border bg-muted text-muted-foreground shadow-sm">
          <WrenchIcon className="size-5" />
        </span>
        <div className="grid gap-1">
          <h2 className="font-heading text-xl font-semibold">
            What would you like to adjust?
          </h2>
          <p className="text-sm text-muted-foreground">
            Fix a bug, tweak a detail, or ask about your code. Chat is for
            focused changes; use the backlog to plan larger features.
          </p>
        </div>
      </div>
    </div>
  )
}
