import type { ProjectRunConfiguration } from "@blame/agent-runtime"
import * as React from "react"
import { toast } from "sonner"

import { usePlatform, type TerminalClient } from "@/context/platform"

export type ProjectRunSession = {
  configurationId: string
  logs: string
  name: string
  sessionId?: string
  status: "running" | "stopped" | "error"
}

type SessionRuntime = {
  sessionId: string
  unsubscribe: () => void
}

export function useProjectRunner(
  configurations: ProjectRunConfiguration[],
  projectPath?: string
) {
  const terminal = usePlatform().terminal
  const [selectedId, setSelectedId] = React.useState(
    () => defaultConfiguration(configurations)?.id
  )
  const [activeSessionId, setActiveSessionId] = React.useState<string>()
  const [logsOpen, setLogsOpen] = React.useState(false)
  const [sessions, setSessions] = React.useState<ProjectRunSession[]>([])
  const runtimesRef = React.useRef(new Map<string, SessionRuntime>())
  useRunnerCleanup(terminal, runtimesRef)
  const selected = selectedConfiguration(configurations, selectedId)
  const selectedSession = sessionFor(sessions, selected?.id)
  const activeSession =
    sessionFor(sessions, activeSessionId) ?? selectedSession ?? sessions[0]
  return {
    activeSession,
    logsOpen,
    runningCount: sessions.filter((session) => session.status === "running").length,
    selected,
    selectedSession,
    sessions,
    terminal,
    select: (id: string) => {
      setSelectedId(id)
      if (sessionFor(sessions, id)) setActiveSessionId(id)
    },
    selectSession: setActiveSessionId,
    sessionFor: (id: string) => sessionFor(sessions, id),
    setLogsOpen,
    start: (id: string) =>
      void startConfiguration(
        configurations.find((configuration) => configuration.id === id),
        projectPath,
        terminal,
        runnerActions()
      ),
    startSelected: () =>
      void startConfiguration(selected, projectPath, terminal, runnerActions()),
    stop: (id: string) => void stopConfiguration(id, terminal, runnerActions()),
    stopSelected: () =>
      selected && void stopConfiguration(selected.id, terminal, runnerActions()),
  }

  function runnerActions(): RunnerActions {
    return { runtimes: runtimesRef.current, setActiveSessionId, setLogsOpen, setSessions }
  }
}

type RunnerActions = {
  runtimes: Map<string, SessionRuntime>
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | undefined>>
  setLogsOpen: React.Dispatch<React.SetStateAction<boolean>>
  setSessions: React.Dispatch<React.SetStateAction<ProjectRunSession[]>>
}

async function startConfiguration(
  configuration: ProjectRunConfiguration | undefined,
  projectPath: string | undefined,
  terminal: TerminalClient | undefined,
  actions: RunnerActions
) {
  if (!configuration || !projectPath || !terminal) return
  if (actions.runtimes.has(configuration.id)) {
    await stopConfiguration(configuration.id, terminal, actions)
  }
  openSession(configuration, projectPath, actions)
  try {
    const session = await terminal.start({
      cwd: configurationPath(projectPath, configuration.cwd),
    })
    const unsubscribe = subscribeToOutput(configuration.id, session.id, terminal, actions)
    actions.runtimes.set(configuration.id, { sessionId: session.id, unsubscribe })
    updateSession(actions, configuration.id, { sessionId: session.id, status: "running" })
    const written = await terminal.write({ id: session.id, data: `${configuration.command}\n` })
    if (!written) throw new Error("Unable to write the launch command")
  } catch (error) {
    const runtime = actions.runtimes.get(configuration.id)
    runtime?.unsubscribe()
    if (runtime) await terminal.stop(runtime.sessionId)
    actions.runtimes.delete(configuration.id)
    updateSession(actions, configuration.id, {
      logs: `${initialLogs(configuration, projectPath)}\n${errorText(error)}\n`,
      status: "error",
    })
    toast.error(`Unable to start ${configuration.name}`, {
      description: errorText(error),
      position: "bottom-right",
    })
  }
}

function openSession(
  configuration: ProjectRunConfiguration,
  projectPath: string,
  actions: RunnerActions
) {
  const session: ProjectRunSession = {
    configurationId: configuration.id,
    logs: initialLogs(configuration, projectPath),
    name: configuration.name,
    status: "running",
  }
  actions.setSessions((sessions) => replaceSession(sessions, session))
  actions.setActiveSessionId(configuration.id)
  actions.setLogsOpen(true)
}

async function stopConfiguration(
  configurationId: string,
  terminal: TerminalClient | undefined,
  actions: RunnerActions
) {
  const runtime = actions.runtimes.get(configurationId)
  if (!runtime || !terminal) return
  runtime.unsubscribe()
  actions.runtimes.delete(configurationId)
  await terminal.stop(runtime.sessionId)
  appendLogs(actions, configurationId, "\n[stopped by user]\n", "stopped")
}

function subscribeToOutput(
  configurationId: string,
  sessionId: string,
  terminal: TerminalClient,
  actions: RunnerActions
) {
  return terminal.onEvent(sessionId, (event) => {
    if (event.type !== "exit") {
      appendLogs(actions, configurationId, event.data)
      return
    }
    appendLogs(actions, configurationId, `\n[process exited ${event.data}]\n`, "stopped")
    actions.runtimes.get(configurationId)?.unsubscribe()
    actions.runtimes.delete(configurationId)
  })
}

function useRunnerCleanup(
  terminal: TerminalClient | undefined,
  runtimesRef: React.RefObject<Map<string, SessionRuntime>>
) {
  React.useEffect(
    () => () => {
      for (const runtime of runtimesRef.current.values()) {
        runtime.unsubscribe()
        void terminal?.stop(runtime.sessionId)
      }
      runtimesRef.current.clear()
    },
    [runtimesRef, terminal]
  )
}

function appendLogs(
  actions: RunnerActions,
  configurationId: string,
  output: string,
  status?: ProjectRunSession["status"]
) {
  actions.setSessions((sessions) =>
    sessions.map((session) =>
      session.configurationId === configurationId
        ? { ...session, logs: `${session.logs}${output}`, status: status ?? session.status }
        : session
    )
  )
}

function updateSession(
  actions: RunnerActions,
  configurationId: string,
  update: Partial<ProjectRunSession>
) {
  actions.setSessions((sessions) =>
    sessions.map((session) =>
      session.configurationId === configurationId ? { ...session, ...update } : session
    )
  )
}

function replaceSession(sessions: ProjectRunSession[], session: ProjectRunSession) {
  return [...sessions.filter((item) => item.configurationId !== session.configurationId), session]
}

function sessionFor(sessions: ProjectRunSession[], configurationId?: string) {
  return sessions.find((session) => session.configurationId === configurationId)
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
  return configurations.find((configuration) => configuration.default) ?? configurations[0]
}

function initialLogs(configuration: ProjectRunConfiguration, projectPath: string) {
  return `$ cd ${configurationPath(projectPath, configuration.cwd)}\n$ ${configuration.command}\n`
}

function configurationPath(projectPath: string, cwd: string) {
  if (cwd === ".") return projectPath
  return `${projectPath.replace(/[\\/]+$/, "")}/${cwd}`
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
