import { LoaderCircleIcon } from "lucide-react"

export function LoadingScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-foreground">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircleIcon className="size-4 animate-spin" />
        <span>Loading OpenCode</span>
      </div>
    </main>
  )
}
