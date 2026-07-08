import type { ProjectRunConfiguration } from "@blame/agent-runtime"
import {
  ChevronDownIcon,
  MonitorIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react"
import * as React from "react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Drawer, DrawerContent, DrawerHeader } from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
    <TooltipProvider>
      <ButtonGroup className="rounded-lg border bg-muted p-0.5">
        <RunnerConfigurationMenu
          configurations={configurations}
          onPreviewWarmup={requestPreviewWarmup}
          runner={runner}
        />
        <RunnerStartButton
          projectPath={projectPath}
          runner={runner}
          onPreviewWarmup={requestPreviewWarmup}
        />
        <RunnerPreviewButton
          runner={runner}
          onOpen={() => setPreviewOpen(true)}
        />
        <RunnerStopButton runner={runner} />
        <RunnerLogsButton runner={runner} />
      </ButtonGroup>
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
    </TooltipProvider>
  )
}

type ProjectPreviewWarmupRequest = {
  configurationId: string
  trigger: number
}

function RunnerConfigurationMenu({
  configurations,
  onPreviewWarmup,
  runner,
}: {
  configurations: ProjectRunConfiguration[]
  onPreviewWarmup: (configuration?: ProjectRunConfiguration) => void
  runner: Runner
}) {
  return (
    <DropdownMenu>
      <RunnerConfigurationTrigger runner={runner} />
      <RunnerConfigurationContent
        configurations={configurations}
        onPreviewWarmup={onPreviewWarmup}
        runner={runner}
      />
    </DropdownMenu>
  )
}

function RunnerConfigurationTrigger({ runner }: { runner: Runner }) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        className="min-w-36 justify-between"
        type="button"
        variant="ghost"
      >
        <span className="flex min-w-0 items-center gap-2">
          <RunStatusDot session={runner.selectedSession} />
          <span className="truncate">{runner.selected?.name}</span>
        </span>
        <ChevronDownIcon />
      </Button>
    </DropdownMenuTrigger>
  )
}

function RunnerConfigurationContent({
  configurations,
  onPreviewWarmup,
  runner,
}: {
  configurations: ProjectRunConfiguration[]
  onPreviewWarmup: (configuration?: ProjectRunConfiguration) => void
  runner: Runner
}) {
  return (
    <DropdownMenuContent align="end" className="min-w-64">
      <DropdownMenuLabel>Run configurations</DropdownMenuLabel>
      <DropdownMenuSeparator />
      {configurations.map((configuration) => (
        <ConfigurationMenuItem
          key={configuration.id}
          configuration={configuration}
          onPreviewWarmup={onPreviewWarmup}
          runner={runner}
        />
      ))}
    </DropdownMenuContent>
  )
}

function ConfigurationMenuItem({
  configuration,
  onPreviewWarmup,
  runner,
}: {
  configuration: ProjectRunConfiguration
  onPreviewWarmup: (configuration?: ProjectRunConfiguration) => void
  runner: Runner
}) {
  const session = runner.sessionFor(configuration.id)
  return (
    <DropdownMenuItem
      className="py-1.5"
      onSelect={() => runner.select(configuration.id)}
    >
      <RunStatusDot session={session} />
      <span className="flex-1 truncate">{configuration.name}</span>
      <ConfigurationMenuAction
        configuration={configuration}
        onPreviewWarmup={onPreviewWarmup}
        running={session?.status === "running"}
        runner={runner}
      />
    </DropdownMenuItem>
  )
}

function ConfigurationMenuAction({
  configuration,
  onPreviewWarmup,
  running,
  runner,
}: {
  configuration: ProjectRunConfiguration
  onPreviewWarmup: (configuration?: ProjectRunConfiguration) => void
  running: boolean
  runner: Runner
}) {
  const run = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (running) runner.stop(configuration.id)
    else {
      onPreviewWarmup(configuration)
      runner.start(configuration.id)
    }
  }
  return (
    <button
      aria-label={running ? "Stop configuration" : "Run configuration"}
      className="rounded-md p-1 hover:bg-foreground/10"
      type="button"
      onPointerDown={run}
    >
      {running ? (
        <SquareIcon className="text-destructive" />
      ) : (
        <PlayIcon className="text-emerald-500" />
      )}
    </button>
  )
}

function RunnerStartButton({
  onPreviewWarmup,
  projectPath,
  runner,
}: {
  onPreviewWarmup: (configuration?: ProjectRunConfiguration) => void
  projectPath?: string
  runner: Runner
}) {
  const running = runner.selectedSession?.status === "running"
  const start = () => {
    onPreviewWarmup(runner.selected)
    runner.startSelected()
  }
  return (
    <IconTooltip label={running ? "Rerun configuration" : "Run configuration"}>
      <Button
        className={
          running
            ? "bg-emerald-600 text-white hover:bg-emerald-500"
            : "bg-muted text-emerald-500 hover:bg-muted/80 hover:text-emerald-400"
        }
        disabled={!projectPath || !runner.terminal}
        size="icon"
        type="button"
        onClick={start}
      >
        {running ? <RotateCwIcon /> : <PlayIcon />}
      </Button>
    </IconTooltip>
  )
}

function RunnerStopButton({ runner }: { runner: Runner }) {
  const running = runner.selectedSession?.status === "running"
  return (
    <IconTooltip label="Stop selected configuration">
      <Button
        className={
          running
            ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
            : "bg-muted text-destructive hover:bg-muted/80"
        }
        disabled={!running}
        size="icon"
        type="button"
        onClick={runner.stopSelected}
      >
        <SquareIcon />
      </Button>
    </IconTooltip>
  )
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
    <IconTooltip label="Open preview">
      <Button
        disabled={!previewUrl}
        size="icon"
        type="button"
        variant="ghost"
        onClick={onOpen}
      >
        <MonitorIcon />
      </Button>
    </IconTooltip>
  )
}

function RunnerLogsButton({ runner }: { runner: Runner }) {
  return (
    <IconTooltip label="Open run logs">
      <Button
        disabled={runner.sessions.length === 0}
        size="icon"
        type="button"
        variant="ghost"
        onClick={() => runner.setLogsOpen(true)}
      >
        <TerminalIcon />
      </Button>
    </IconTooltip>
  )
}

function IconTooltip({
  children,
  label,
}: {
  children: React.ReactElement
  label: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
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
    <Tabs
      value={session?.configurationId}
      onValueChange={runner.selectSession}
      className="overflow-y-hidden"
    >
      <TabsList>
        {runner.sessions.map((item) => (
          <TabsTrigger key={item.configurationId} value={item.configurationId}>
            <RunStatusDot session={item} />
            {item.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
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

function RunStatusDot({ session }: { session?: ProjectRunSession }) {
  const tone =
    session?.status === "running"
      ? "bg-emerald-500"
      : session?.status === "error"
        ? "bg-destructive"
        : "bg-muted-foreground/45"
  return <span className={`size-2 shrink-0 rounded-full ${tone}`} />
}
