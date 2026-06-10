import { SendIcon, ServerOffIcon, SquareIcon, TerminalIcon } from "lucide-react"
import * as React from "react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { usePlatform } from "@/context/platform"

export function DevelopmentTerminal({ userStory }: { userStory?: UserStory }) {
  const platform = usePlatform()
  const [command, setCommand] = React.useState("")
  const [error, setError] = React.useState<string>()
  const [output, setOutput] = React.useState("")
  const [sessionId, setSessionId] = React.useState<string>()

  React.useEffect(() => {
    if (!userStory?.worktree || !platform.terminal) return
    let terminalId: string | undefined
    let unsubscribe: (() => void) | undefined

    platform.terminal
      .start({ cwd: userStory.worktree })
      .then((session) => {
        terminalId = session.id
        setSessionId(session.id)
        setOutput(`$ cd ${session.cwd}\n`)
        unsubscribe = platform.terminal?.onEvent(session.id, (event) => {
          if (event.type === "exit") {
            setOutput((current) => `${current}\n[process exited ${event.data}]\n`)
            setSessionId(undefined)
            return
          }
          setOutput((current) => `${current}${event.data}`)
        })
      })
      .catch((error) => {
        setError(error instanceof Error ? error.message : "Unable to start terminal")
      })

    return () => {
      unsubscribe?.()
      if (terminalId) void platform.terminal?.stop(terminalId)
    }
  }, [platform.terminal, userStory?.worktree])

  if (!userStory?.worktree) {
    return (
      <TerminalEmptyState
        description="This user story does not have a worktree yet."
        icon={TerminalIcon}
        title="No worktree"
      />
    )
  }

  if (!platform.terminal) {
    return (
      <TerminalEmptyState
        description="The desktop terminal bridge is unavailable."
        icon={ServerOffIcon}
        title="Terminal unavailable"
      />
    )
  }

  const submit = () => {
    if (!sessionId || !platform.terminal || !command.trim()) return
    setOutput((current) => `${current}$ ${command}\n`)
    void platform.terminal.write({ id: sessionId, data: `${command}\n` })
    setCommand("")
  }

  return (
    <div className="grid h-full min-h-96 grid-rows-[minmax(0,1fr)_auto] bg-background">
      <pre className="min-h-0 overflow-auto bg-zinc-950 p-4 font-mono text-xs whitespace-pre-wrap text-zinc-100 select-text">
        {error ? error : output || "Starting terminal..."}
      </pre>
      <form
        className="flex gap-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          value={command}
          className="font-mono"
          placeholder="Run command"
          onChange={(event) => setCommand(event.currentTarget.value)}
        />
        {sessionId ? (
          <Button type="button" variant="outline" onClick={() => void platform.terminal?.stop(sessionId)}>
            <SquareIcon />
            Stop
          </Button>
        ) : null}
        <Button type="submit" disabled={!sessionId || !command.trim()}>
          <SendIcon />
          Run
        </Button>
      </form>
    </div>
  )
}

function TerminalEmptyState({
  description,
  icon: Icon,
  title,
}: {
  description: string
  icon: React.ComponentType<{ className?: string }>
  title: string
}) {
  return (
    <div className="flex h-full min-h-96 flex-col items-center justify-center gap-3 bg-muted/20 p-8 text-center">
      <Icon className="size-8 text-muted-foreground" />
      <div>
        <h3 className="font-heading text-lg font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
