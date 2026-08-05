import { FitAddon } from "@xterm/addon-fit"
import { Terminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import { ServerOffIcon, SquareIcon, TerminalIcon } from "lucide-react"
import * as React from "react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { Button } from "@/components/ui/button"
import { usePlatform } from "@/context/platform"

const terminalTheme = {
  background: "#09090b",
  cursor: "#f4f4f5",
  selectionBackground: "rgba(96, 165, 250, 0.35)",
  foreground: "#f4f4f5",
}

export function DevelopmentTerminal({ userStory }: { userStory?: UserStory }) {
  const platform = usePlatform()
  const terminalElement = React.useRef<HTMLDivElement>(null)
  const terminalSession = React.useRef<string | undefined>(undefined)
  const [error, setError] = React.useState<string>()
  const [sessionId, setSessionId] = React.useState<string>()

  React.useEffect(() => {
    const element = terminalElement.current
    const terminalApi = platform.terminal
    const worktree = userStory?.worktree
    if (!element || !terminalApi || !worktree) return

    let cancelled = false
    let unsubscribe: (() => void) | undefined
    let sessionId: string | undefined
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      fontSize: 12,
      scrollback: 10_000,
      theme: terminalTheme,
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(element)
    fitAddon.fit()

    const resize = () => {
      fitAddon.fit()
      if (!sessionId) return
      void terminalApi.resize({
        cols: terminal.cols,
        id: sessionId,
        rows: terminal.rows,
      })
    }
    const resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(element)
    const dataDisposable = terminal.onData((data) => {
      const id = terminalSession.current
      if (id) void terminalApi.write({ data, id })
    })

    terminal.write("\x1b[90mStarting terminal…\x1b[0m\r\n")
    terminalApi
      .start({ cwd: worktree })
      .then((session) => {
        if (cancelled) {
          void terminalApi.stop(session.id)
          return
        }
        sessionId = session.id
        terminalSession.current = session.id
        setError(undefined)
        setSessionId(session.id)
        resize()
        unsubscribe = terminalApi.onEvent(session.id, (event) => {
          if (event.type === "exit") {
            terminal.write(
              `\r\n\x1b[90m[process exited ${event.data}]\x1b[0m\r\n`
            )
            terminalSession.current = undefined
            setSessionId(undefined)
            return
          }
          terminal.write(event.data)
        })
      })
      .catch((startError) => {
        if (cancelled) return
        setError(
          startError instanceof Error
            ? startError.message
            : "Unable to start terminal"
        )
        terminal.write("\r\n\x1b[31mUnable to start terminal.\x1b[0m\r\n")
      })

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      dataDisposable.dispose()
      unsubscribe?.()
      if (sessionId) void terminalApi.stop(sessionId)
      terminalSession.current = undefined
      terminal.dispose()
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

  return (
    <div className="grid h-full min-h-96 grid-rows-[minmax(0,1fr)_auto] bg-background">
      <div
        aria-label="Development terminal"
        className="min-h-0 overflow-hidden bg-zinc-950 p-3"
        ref={terminalElement}
        role="application"
      />
      <div className="flex items-center gap-3 border-t p-3">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
          {error ??
            (sessionId ? "Interactive shell connected" : "Starting terminal…")}
        </span>
        {sessionId ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void platform.terminal?.stop(sessionId)}
          >
            <SquareIcon />
            Stop
          </Button>
        ) : null}
      </div>
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
