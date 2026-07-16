import type { ProjectRunConfiguration } from "@blame/agent-runtime"
import { MonitorIcon, SquareIcon, TerminalIcon } from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerHeader } from "@/components/ui/drawer"
import {
  ProjectRunnerControls,
  ProjectRunnerLogTabs,
  RunnerIconTooltip,
} from "@/components/backlog/board/project-runner-controls"
import {
  type ProjectRunSession,
  useProjectRunner,
} from "@/components/backlog/board/use-project-runner"
import {
  projectRunConfigurationPreviewKey,
  projectRunConfigurationPreviewUrl,
} from "@/components/backlog/board/project-run-configuration"
import { ProjectRunConfigurationPreviewWarmup } from "@/components/backlog/board/project-run-preview-warmup"
import { UserStoryPreview } from "@/components/backlog/drawer/user-story-preview"

type Runner = ReturnType<typeof useProjectRunner>

export function ProjectRunnerButton({
  configurations,
  projectPath,
}: {
  configurations: ProjectRunConfiguration[]
  projectPath?: string
}) {
  const runner = useProjectRunner(configurations, projectPath)
  const [previewOpen, setPreviewOpen] = React.useState(false)
  const [warmupRequest, setWarmupRequest] =
    React.useState<ProjectPreviewWarmupRequest>()
  const warmupConfiguration = configurations.find(
    (configuration) => configuration.id === warmupRequest?.configurationId
  )
  const requestPreviewWarmup = React.useCallback(
    (configuration?: ProjectRunConfiguration) => {
      if (!configuration) return
      if (!projectRunConfigurationPreviewUrl(configuration)) return
      setWarmupRequest((current) => ({
        configurationId: configuration.id,
        trigger: (current?.trigger ?? 0) + 1,
      }))
    },
    []
  )
  if (!runner.selected) return null
  return (
    <>
      <ProjectRunnerControls
        afterStart={
          <RunnerPreviewButton
            runner={runner}
            onOpen={() => setPreviewOpen(true)}
          />
        }
        afterStop={<RunnerLogsButton runner={runner} />}
        configurations={configurations}
        disabled={!projectPath || !runner.terminal}
        pending={runner.pendingOperation}
        selectedId={runner.selected.id}
        statusFor={(id) => runner.sessionFor(id)?.status ?? "stopped"}
        onSelect={runner.select}
        onStart={(id) => {
          requestPreviewWarmup(
            configurations.find((configuration) => configuration.id === id)
          )
          runner.start(id)
        }}
        onStop={runner.stop}
      />
      <RunnerLogsDrawer runner={runner} />
      <RunnerPreviewDrawer
        open={previewOpen}
        projectPath={projectPath}
        runner={runner}
        onOpenChange={setPreviewOpen}
      />
      <ProjectRunConfigurationPreviewWarmup
        configuration={warmupConfiguration}
        scope={projectPath}
        trigger={warmupRequest?.trigger}
      />
    </>
  )
}

type ProjectPreviewWarmupRequest = {
  configurationId: string
  trigger: number
}

function RunnerPreviewButton({
  runner,
  onOpen,
}: {
  runner: Runner
  onOpen: () => void
}) {
  const previewUrl = projectRunConfigurationPreviewUrl(runner.selected)
  return (
    <RunnerIconTooltip label="Open preview">
      <Button
        disabled={!previewUrl}
        size="icon"
        type="button"
        variant="ghost"
        onClick={onOpen}
      >
        <MonitorIcon />
      </Button>
    </RunnerIconTooltip>
  )
}

function RunnerLogsButton({ runner }: { runner: Runner }) {
  return (
    <RunnerIconTooltip label="Open run logs">
      <Button
        disabled={runner.sessions.length === 0}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => runner.setLogsOpen(true)}
      >
        <TerminalIcon />
      </Button>
    </RunnerIconTooltip>
  )
}

function RunnerPreviewDrawer({
  open,
  projectPath,
  runner,
  onOpenChange,
}: {
  open: boolean
  projectPath?: string
  runner: Runner
  onOpenChange: (open: boolean) => void
}) {
  const previewUrl = projectRunConfigurationPreviewUrl(runner.selected)
  const previewSessionKey = projectRunConfigurationPreviewKey(
    runner.selected,
    projectPath
  )
  return (
    <Drawer direction="bottom" open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="h-[80vh] overflow-hidden p-0">
        {previewUrl ? (
          <UserStoryPreview
            previewSessionKey={previewSessionKey}
            previewTitle={runner.selected?.name}
            previewUrl={previewUrl}
            visible={open}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

function RunnerLogsDrawer({ runner }: { runner: Runner }) {
  const activeSession = runner.activeSession
  return (
    <Drawer
      direction="bottom"
      open={runner.logsOpen}
      onOpenChange={runner.setLogsOpen}
    >
      <DrawerContent className="h-[50vh]">
        <RunnerLogsHeader runner={runner} session={activeSession} />
        {activeSession ? (
          <RunnerLogOutput
            key={activeSession.configurationId}
            session={activeSession}
          />
        ) : null}
      </DrawerContent>
    </Drawer>
  )
}

function RunnerLogsHeader({
  runner,
  session,
}: {
  runner: Runner
  session?: ProjectRunSession
}) {
  return (
    <DrawerHeader className="gap-3 border-b px-5 py-3 text-left">
      <div className="flex items-center gap-2 overflow-x-auto">
        <RunnerSessionTabs runner={runner} session={session} />
        <Button
          disabled={session?.status !== "running"}
          size="icon-sm"
          type="button"
          variant="destructive"
          onClick={() => session && runner.stop(session.configurationId)}
        >
          <SquareIcon />
          <span className="sr-only">Stop selected run</span>
        </Button>
      </div>
    </DrawerHeader>
  )
}

function RunnerSessionTabs({
  runner,
  session,
}: {
  runner: Runner
  session?: ProjectRunSession
}) {
  return (
    <ProjectRunnerLogTabs
      items={runner.sessions.map((item) => ({
        id: item.configurationId,
        label: item.name,
        status: item.status,
      }))}
      value={session?.configurationId}
      onValueChange={runner.selectSession}
    />
  )
}

function RunnerLogOutput({ session }: { session: ProjectRunSession }) {
  const outputRef = React.useRef<HTMLPreElement>(null)
  React.useEffect(() => {
    const output = outputRef.current
    if (output) output.scrollTop = output.scrollHeight
  }, [session.logs])
  return (
    <pre
      ref={outputRef}
      className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs whitespace-pre-wrap text-zinc-100 select-text"
    >
      {session.logs || "No output yet."}
    </pre>
  )
}
