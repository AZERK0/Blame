import * as React from "react"
import type { FitAddon, Ghostty, Terminal as GhosttyTerminal } from "ghostty-web"
import { PlusIcon, ServerOffIcon, TerminalIcon, XIcon } from "lucide-react"

import type { UserStory } from "@/components/backlog/data/backlog-data"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useServer } from "@/context/server"
import { createSdkForServer } from "@/lib/opencode-client"

type GhosttyBundle = {
  mod: typeof import("ghostty-web")
  ghostty: Ghostty
}

type TerminalTab = {
  error?: string
  id: string
  title: string
}

let ghosttyBundle: Promise<GhosttyBundle> | undefined

export function DevelopmentTerminal({ userStory }: { userStory?: UserStory }) {
  const server = useServer()

  if (!server.server) {
    return (
      <TerminalEmptyState
        description="Connect to an OpenCode server to start a terminal."
        icon={ServerOffIcon}
        title="Backend unavailable"
      />
    )
  }

  if (!userStory?.worktree) {
    return (
      <TerminalEmptyState
        description="This user story does not have a worktree yet."
        icon={TerminalIcon}
        title="No worktree"
      />
    )
  }

  return (
    <TerminalTabs
      key={userStory.worktree}
      server={server.server}
      worktree={userStory.worktree}
    />
  )
}

function TerminalTabs({
  server,
  worktree,
}: {
  server: NonNullable<ReturnType<typeof useServer>["server"]>
  worktree: string
}) {
  const [state, setState] = React.useState(createInitialTerminalTabs)

  const addTab = () => {
    setState((current) => {
      const tab = createTerminalTab(current.nextNumber)
      return {
        activeTab: tab.id,
        nextNumber: current.nextNumber + 1,
        tabs: [...current.tabs, tab],
      }
    })
  }

  const closeTab = (id: string) => {
    setState((current) => closeTerminalTab(current, id))
  }

  const updateError = (id: string, error: string | undefined) => {
    setState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => tab.id === id ? { ...tab, error } : tab),
    }))
  }

  return (
    <Tabs
      className="h-full min-h-0 gap-0 bg-background"
      value={state.activeTab}
      onValueChange={(activeTab) => setState((current) => ({ ...current, activeTab }))}
    >
      <div className="flex shrink-0 items-center border-b bg-background pr-2">
        <ScrollArea className="min-w-0 flex-1">
          <TabsList className="overflow-y-hidden" variant="line">
            {state.tabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                <TerminalIcon className="size-4" />
                <span className="max-w-40 truncate">{tab.title}</span>
                {tab.error && <span className="size-1.5 rounded-full bg-destructive" />}
                {state.tabs.length > 1 && (
                  <span
                    className="ml-1 inline-flex size-5 items-center justify-center rounded-md hover:bg-muted"
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation()
                      closeTab(tab.id)
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return
                      event.preventDefault()
                      event.stopPropagation()
                      closeTab(tab.id)
                    }}
                  >
                    <XIcon className="size-3" />
                    <span className="sr-only">Close terminal</span>
                  </span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>
        <Button size="icon-sm" variant="ghost" onClick={addTab}>
          <PlusIcon />
          <span className="sr-only">New terminal</span>
        </Button>
      </div>
      {state.tabs.map((tab) => (
        <TabsContent
          className="min-h-0 flex-col data-[state=active]:flex data-[state=inactive]:hidden"
          forceMount
          key={tab.id}
          value={tab.id}
        >
          {tab.error && (
            <div className="border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {tab.error}
            </div>
          )}
          <TerminalSession
            active={state.activeTab === tab.id}
            server={server}
            worktree={worktree}
            onError={(error) => updateError(tab.id, error)}
          />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function TerminalSession({
  active,
  onError,
  server,
  worktree,
}: {
  active: boolean
  onError: (error: string | undefined) => void
  server: NonNullable<ReturnType<typeof useServer>["server"]>
  worktree: string
}) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const activeRef = React.useRef(active)
  const fitAddonRef = React.useRef<FitAddon | undefined>(undefined)
  const onErrorRef = React.useRef(onError)
  const terminalRef = React.useRef<GhosttyTerminal | undefined>(undefined)

  React.useEffect(() => {
    onErrorRef.current = onError
  }, [onError])

  React.useEffect(() => {
    activeRef.current = active
    if (!active) return
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit()
      terminalRef.current?.focus()
    })
  }, [active])

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let socket: WebSocket | undefined
    let terminal: GhosttyTerminal | undefined
    let fitAddon: FitAddon | undefined
    let removePty: (() => void) | undefined
    let resizeFrame: number | undefined
    let resizeObserver: ResizeObserver | undefined

    const cleanup = () => {
      cancelled = true
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      resizeObserver?.disconnect()
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close(1000)
      removePty?.()
      terminal?.dispose()
      fitAddonRef.current = undefined
      terminalRef.current = undefined
      container.replaceChildren()
    }

    const run = async () => {
      onErrorRef.current(undefined)
      const client = createSdkForServer(server)
      const pty = await client.pty.create({
        directory: worktree,
        cwd: worktree,
        title: "User Story Terminal",
      })
      const id = pty.data?.id
      if (!id) throw new Error("Unable to create terminal session")
      removePty = () => {
        void client.pty.remove({
          directory: worktree,
          ptyID: id,
        })
      }
      if (cancelled) return

      const loaded = await loadGhostty()
      if (cancelled) return

      terminal = new loaded.mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        ghostty: loaded.ghostty,
        scrollback: 10_000,
        theme: terminalTheme(),
      })
      fitAddon = new loaded.mod.FitAddon()
      terminal.loadAddon(fitAddon)
      terminal.open(container)
      fitAddonRef.current = fitAddon
      terminalRef.current = terminal
      if (activeRef.current) terminal.focus()

      const pushSize = () => {
        if (cancelled || !terminal) return
        void client.pty.update({
          directory: worktree,
          ptyID: id,
          size: {
            cols: terminal.cols,
            rows: terminal.rows,
          },
        })
      }

      const fit = () => {
        if (resizeFrame !== undefined) return
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          if (cancelled) return
          fitAddon?.fit()
          pushSize()
        })
      }

      resizeObserver = new ResizeObserver(fit)
      resizeObserver.observe(container)
      fit()

      terminal.onData((data) => {
        if (socket?.readyState === WebSocket.OPEN) socket.send(data)
      })

      socket = new WebSocket(terminalUrl(server, worktree, id))
      socket.binaryType = "arraybuffer"
      socket.addEventListener("open", pushSize)
      socket.addEventListener("message", (event) => {
        if (cancelled || !terminal) return
        if (typeof event.data !== "string") return
        terminal.write(event.data)
      })
      socket.addEventListener("close", (event) => {
        if (cancelled || event.code === 1000) return
        onErrorRef.current(`Terminal connection closed (${event.code}).`)
      })
      socket.addEventListener("error", () => {
        if (!cancelled) onErrorRef.current("Terminal connection failed.")
      })
    }

    void run().catch((error) => {
      if (cancelled) return
      onErrorRef.current(error instanceof Error ? error.message : "Unable to start terminal.")
    })

    return cleanup
  }, [server, worktree])

  return (
    <div
      className="h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-[#191515] px-4 py-3"
      data-component="development-terminal"
      data-prevent-autofocus
      ref={containerRef}
      tabIndex={-1}
    />
  )
}

function closeTerminalTab(
  state: ReturnType<typeof createInitialTerminalTabs>,
  id: string
) {
  if (state.tabs.length === 1) return state
  const index = state.tabs.findIndex((tab) => tab.id === id)
  const tabs = state.tabs.filter((tab) => tab.id !== id)
  return {
    ...state,
    activeTab: state.activeTab === id ? tabs[Math.max(0, index - 1)].id : state.activeTab,
    tabs,
  }
}

function createInitialTerminalTabs() {
  const tab = createTerminalTab(1)
  return {
    activeTab: tab.id,
    nextNumber: 2,
    tabs: [tab],
  }
}

function createTerminalTab(number: number): TerminalTab {
  return {
    id: crypto.randomUUID(),
    title: `Terminal ${number}`,
  }
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

function loadGhostty() {
  if (!ghosttyBundle) {
    ghosttyBundle = import("ghostty-web").then(async (mod) => ({
      mod,
      ghostty: await mod.Ghostty.load(),
    }))
  }
  return ghosttyBundle
}

function terminalTheme() {
  return {
    background: "#191515",
    cursor: "#d4d4d4",
    foreground: "#d4d4d4",
    selectionBackground: "rgba(212, 212, 212, 0.25)",
  }
}

function terminalUrl(
  server: NonNullable<ReturnType<typeof useServer>["server"]>,
  worktree: string,
  ptyID: string
) {
  const url = new URL(`/pty/${ptyID}/connect`, server.url)
  url.searchParams.set("directory", worktree)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  if (server.password) {
    url.searchParams.set("auth_token", btoa(`${server.username ?? "opencode"}:${server.password}`))
    url.username = server.username ?? "opencode"
    url.password = server.password
  }
  return url
}
