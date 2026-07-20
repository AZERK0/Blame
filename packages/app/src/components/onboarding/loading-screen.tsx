import { LoaderCircleIcon } from "lucide-react"

import { CompactWindowChrome } from "@/components/layout/compact-window-chrome"

export function LoadingScreen() {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-background text-foreground">
      <CompactWindowChrome settings={false} />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        <span>Loading Blame</span>
      </div>
    </main>
  )
}
