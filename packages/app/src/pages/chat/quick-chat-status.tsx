export function QuickChatStatus({
  error,
  loading,
  projectPath,
}: {
  error?: string
  loading: boolean
  projectPath?: string
}) {
  if (!projectPath) {
    return (
      <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        Open a project to use quick chat.
      </div>
    )
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    )
  }
  if (!loading) return null
  return (
    <div className="rounded-lg border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
      Loading quick chats.
    </div>
  )
}
