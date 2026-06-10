import type { ProjectRunConfiguration } from "@blame/agent-runtime"
import {
  ChevronDownIcon,
  PlayIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePlatform, type TerminalClient } from "@/context/platform"

type Runner = ReturnType<typeof useProjectRunner>

export function ProjectRunnerButton({
  configurations,
  projectPath,
}: {
  configurations: ProjectRunConfiguration[]
  projectPath?: string
}) {
  const runner = useProjectRunner(configurations, projectPath)
  if (!runner.selected) return null
  return (
    <>
      <div className="flex items-center">
        <RunnerActionButton projectPath={projectPath} runner={runner} />
        <RunnerLogsButton runner={runner} />
        <RunnerConfigurationMenu
          configurations={configurations}
          runner={runner}
        />
      </div>
      <RunnerLogsDrawer runner={runner} />
    </>
  )
}

function RunnerActionButton({
  projectPath,
  runner,
}: {
  projectPath?: string
  runner: Runner
}) {
  const running = Boolean(runner.sessionId)
  return (
    <Button
      className="rounded-r-none"
      disabled={!projectPath || !runner.terminal}
      type="button"
      variant={running ? "destructive" : "outline"}
      onClick={running ? runner.stop : runner.start}
    >
      {running ? <SquareIcon /> : <PlayIcon />}
      {running ? "Stop" : runner.selected?.name}
    </Button>
  )
}

function RunnerLogsButton({ runner }: { runner: Runner }) {
  return (
    <Button
      aria-label="Open run logs"
      className="rounded-none border-l-0"
      disabled={!runner.logs}
      size="icon"
      type="button"
      variant="outline"
      onClick={() => runner.setLogsOpen(true)}
    >
      <TerminalIcon />
    </Button>
  )
}

function RunnerLogsDrawer({ runner }: { runner: Runner }) {
  const outputRef = React.useRef<HTMLPreElement>(null)
  React.useEffect(() => {
    const output = outputRef.current
    if (output) output.scrollTop = output.scrollHeight
  }, [runner.logs])
  return (
    <Drawer
      direction="bottom"
      open={runner.logsOpen}
      onOpenChange={runner.setLogsOpen}
    >
      <DrawerContent className="h-[45vh]">
        <DrawerHeader className="border-b px-5 py-3 text-left">
          <DrawerTitle>
            {runner.logsName ?? runner.selected?.name} logs
          </DrawerTitle>
          <DrawerDescription>
            {runner.sessionId ? "Project is running" : "Project is stopped"}
          </DrawerDescription>
        </DrawerHeader>
        <pre
          ref={outputRef}
          className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs whitespace-pre-wrap text-zinc-100 select-text"
        >
          {runner.logs || "No output yet."}
        </pre>
      </DrawerContent>
    </Drawer>
  )
}

function RunnerConfigurationMenu({
  configurations,
  runner,
}: {
  configurations: ProjectRunConfiguration[]
  runner: Runner
}) {
  return (
    <DropdownMenu>
      <RunnerConfigurationTrigger disabled={Boolean(runner.sessionId)} />
      <DropdownMenuContent align="end" className="min-w-56">
        <RunnerConfigurationItems
          configurations={configurations}
          onSelect={runner.setSelectedId}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function RunnerConfigurationTrigger({ disabled }: { disabled: boolean }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        aria-label="Select run configuration"
        className="rounded-l-none border-l-0"
        disabled={disabled}
        size="icon"
        type="button"
        variant="outline"
      >
        <ChevronDownIcon />
      </Button>
    </DropdownMenuTrigger>
  )
}

function RunnerConfigurationItems({
  configurations,
  onSelect,
}: {
  configurations: ProjectRunConfiguration[]
  onSelect(id: string): void
}) {
  return configurations.map((configuration) => (
    <DropdownMenuItem
      key={configuration.id}
      onSelect={() => onSelect(configuration.id)}
    >
      <PlayIcon />
      {configuration.name}
    </DropdownMenuItem>
  ))
}

function useProjectRunner(
  configurations: ProjectRunConfiguration[],
  projectPath?: string
) {
  const terminal = usePlatform().terminal
  const state = useRunnerState(configurations)
  const activeSessionRef = React.useRef<string>()
  const unsubscribeRef = React.useRef<() => void>()
  const selected = selectedConfiguration(configurations, state.selectedId)
  useRunnerCleanup(terminal, activeSessionRef, unsubscribeRef)
  const start = () =>
    void startProject(
      startProjectInput(
        state,
        selected,
        projectPath,
        terminal,
        activeSessionRef,
        unsubscribeRef
      )
    )
  const stop = () =>
    void stopProject(
      stopProjectInput(state, selected, terminal, activeSessionRef, unsubscribeRef)
    )
  return {
    selected,
    terminal,
    start,
    stop,
    ...state,
  }
}

function useRunnerState(configurations: ProjectRunConfiguration[]) {
  const [selectedId, setSelectedId] = React.useState(
    () => defaultConfiguration(configurations)?.id
  )
  const [sessionId, setSessionId] = React.useState<string>()
  const [logs, setLogs] = React.useState("")
  const [logsName, setLogsName] = React.useState<string>()
  const [logsOpen, setLogsOpen] = React.useState(false)
  return {
    logs,
    logsName,
    logsOpen,
    selectedId,
    sessionId,
    setLogs,
    setLogsName,
    setLogsOpen,
    setSelectedId,
    setSessionId,
  }
}

function useRunnerCleanup(
  terminal: TerminalClient | undefined,
  activeSessionRef: React.RefObject<string | undefined>,
  unsubscribeRef: React.RefObject<(() => void) | undefined>
) {
  React.useEffect(
    () => () => {
      unsubscribeRef.current?.()
      if (activeSessionRef.current) void terminal?.stop(activeSessionRef.current)
    },
    [activeSessionRef, terminal, unsubscribeRef]
  )
}

type StartProjectInput = {
  configuration?: ProjectRunConfiguration
  projectPath?: string
  setLogs: React.Dispatch<React.SetStateAction<string>>
  setLogsName: React.Dispatch<React.SetStateAction<string | undefined>>
  setLogsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSessionId: React.Dispatch<React.SetStateAction<string | undefined>>
  terminal?: TerminalClient
  activeSessionRef: React.RefObject<string | undefined>
  unsubscribeRef: React.RefObject<(() => void) | undefined>
}

type RunnerState = ReturnType<typeof useRunnerState>

function startProjectInput(
  state: RunnerState,
  configuration: ProjectRunConfiguration | undefined,
  projectPath: string | undefined,
  terminal: TerminalClient | undefined,
  activeSessionRef: React.RefObject<string | undefined>,
  unsubscribeRef: React.RefObject<(() => void) | undefined>
): StartProjectInput {
  return {
    ...state,
    activeSessionRef,
    configuration,
    projectPath,
    terminal,
    unsubscribeRef,
  }
}

async function startProject(input: StartProjectInput) {
  const { configuration, projectPath, terminal } = input
  if (!terminal || !projectPath || !configuration) return
  let startedSessionId: string | undefined
  input.setLogs(`$ cd ${configurationPath(projectPath, configuration.cwd)}\n$ ${configuration.command}\n`)
  input.setLogsName(configuration.name)
  input.setLogsOpen(true)
  try {
    const session = await terminal.start({
      cwd: configurationPath(projectPath, configuration.cwd),
    })
    startedSessionId = session.id
    input.activeSessionRef.current = session.id
    input.unsubscribeRef.current = subscribeToOutput(terminal, session.id, input)
    input.setSessionId(session.id)
    const written = await terminal.write({
      id: session.id,
      data: `${configuration.command}\n`,
    })
    if (!written) throw new Error("Unable to write the launch command")
    toast.success(`Started ${configuration.name}`, { position: "bottom-right" })
  } catch (error) {
    if (startedSessionId) await terminal.stop(startedSessionId)
    input.activeSessionRef.current = undefined
    input.setLogs((current) => `${current}\n${errorText(error)}\n`)
    showStartError(configuration.name, error)
  }
}

type StopProjectInput = {
  configuration?: ProjectRunConfiguration
  sessionId?: string
  setLogs: React.Dispatch<React.SetStateAction<string>>
  setSessionId: React.Dispatch<React.SetStateAction<string | undefined>>
  terminal?: TerminalClient
  activeSessionRef: React.RefObject<string | undefined>
  unsubscribeRef: React.RefObject<(() => void) | undefined>
}

function stopProjectInput(
  state: RunnerState,
  configuration: ProjectRunConfiguration | undefined,
  terminal: TerminalClient | undefined,
  activeSessionRef: React.RefObject<string | undefined>,
  unsubscribeRef: React.RefObject<(() => void) | undefined>
): StopProjectInput {
  return { ...state, activeSessionRef, configuration, terminal, unsubscribeRef }
}

async function stopProject(input: StopProjectInput) {
  const { configuration, sessionId, terminal } = input
  if (!terminal || !sessionId || !configuration) return
  await terminal.stop(sessionId)
  input.unsubscribeRef.current?.()
  input.unsubscribeRef.current = undefined
  input.activeSessionRef.current = undefined
  input.setLogs((current) => `${current}\n[stopped by user]\n`)
  input.setSessionId(undefined)
  toast.success(`Stopped ${configuration.name}`, { position: "bottom-right" })
}

function subscribeToOutput(
  terminal: TerminalClient,
  sessionId: string,
  input: StartProjectInput
) {
  return terminal.onEvent(sessionId, (event) => {
    if (event.type !== "exit") {
      input.setLogs((current) => `${current}${event.data}`)
      return
    }
    input.setLogs((current) => `${current}\n[process exited ${event.data}]\n`)
    input.setSessionId(undefined)
    input.activeSessionRef.current = undefined
    input.unsubscribeRef.current?.()
    input.unsubscribeRef.current = undefined
  })
}

function showStartError(name: string, error: unknown) {
  toast.error(`Unable to start ${name}`, {
    description: errorText(error),
    position: "bottom-right",
  })
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function selectedConfiguration(
  configurations: ProjectRunConfiguration[],
  selectedId: string | undefined
) {
  return (
    configurations.find((configuration) => configuration.id === selectedId) ??
    defaultConfiguration(configurations)
  )
}

function defaultConfiguration(configurations: ProjectRunConfiguration[]) {
  return (
    configurations.find((configuration) => configuration.default) ??
    configurations[0]
  )
}

function configurationPath(projectPath: string, cwd: string) {
  if (cwd === ".") return projectPath
  return `${projectPath.replace(/[\\/]+$/, "")}/${cwd}`
}
