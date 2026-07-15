import type {
  ProjectPreviewRuntimeState,
  ProjectRunConfiguration,
  ProjectRunConfigurationCategory,
  ProjectRunConfigurationStatus,
} from "@blame/agent-runtime"
import {
  AppWindowIcon,
  BoxIcon,
  ChevronDownIcon,
  LoaderCircleIcon,
  MonitorIcon,
  PlayIcon,
  RotateCwIcon,
  ServerIcon,
  SmartphoneIcon,
  SquareIcon,
  TerminalIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type {
  PreviewRunnerAction,
  UserStoryPreviewRunner,
} from "@/components/backlog/drawer/use-user-story-preview-runner"

export function UserStoryPreviewRunnerControls({
  onConfigurationChange,
  runner,
}: {
  onConfigurationChange?: (configurationId: string, previewUrl?: string) => void
  runner: UserStoryPreviewRunner
}) {
  const selected = selectedConfiguration(runner.runtime)
  if (!runner.runtime || !selected) return null
  const status = runner.runtime.statuses[selected.id] ?? "stopped"
  const control = previewRunnerControl(
    runner,
    selected.id,
    onConfigurationChange
  )
  return (
    <ButtonGroup className="pointer-events-auto rounded-full border bg-background/95 p-0.5 shadow-sm backdrop-blur">
      <PreviewConfigurationMenu runner={runner} onSelect={control} />
      <PreviewStartButton
        pending={runner.pending}
        status={status}
        onStart={() => control(status === "running" ? "restart" : "start")}
      />
      <PreviewStopButton
        disabled={runner.pending || status === "stopped"}
        onStop={() => control("stop")}
      />
    </ButtonGroup>
  )
}

function previewRunnerControl(
  runner: UserStoryPreviewRunner,
  selectedId: string,
  onChange?: (configurationId: string, previewUrl?: string) => void
) {
  return async (action: PreviewRunnerAction, configurationId = selectedId) => {
    const next = await runner.control(action, configurationId)
    if (!next) return
    onChange?.(
      action === "stop" ? selectedId : configurationId,
      action === "stop" ? undefined : next.previewUrl
    )
  }
}

function PreviewStopButton({
  disabled,
  onStop,
}: {
  disabled: boolean
  onStop: () => void
}) {
  return (
    <Button
      aria-label="Stop preview configuration"
      disabled={disabled}
      size="icon-sm"
      type="button"
      variant="ghost"
      onClick={onStop}
    >
      <SquareIcon className="text-destructive" />
    </Button>
  )
}

function PreviewConfigurationMenu({
  onSelect,
  runner,
}: {
  onSelect: (action: PreviewRunnerAction, configurationId: string) => void
  runner: UserStoryPreviewRunner
}) {
  const selected = selectedConfiguration(runner.runtime)
  return (
    <DropdownMenu>
      <PreviewConfigurationTrigger
        disabled={runner.pending}
        selected={selected}
      />
      <DropdownMenuContent align="start" className="min-w-64">
        <DropdownMenuLabel>Worktree run configurations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <PreviewConfigurationItems runner={runner} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PreviewConfigurationTrigger({
  disabled,
  selected,
}: {
  disabled: boolean
  selected?: ProjectRunConfiguration
}) {
  return (
    <DropdownMenuTrigger asChild>
      <Button
        className="max-w-48 gap-2 rounded-full"
        disabled={disabled}
        size="sm"
        variant="ghost"
      >
        <RunCategoryIcon category={selected?.category} />
        <span className="truncate">{selected?.name}</span>
        <ChevronDownIcon />
      </Button>
    </DropdownMenuTrigger>
  )
}

function PreviewConfigurationItems({
  onSelect,
  runner,
}: {
  onSelect: (action: PreviewRunnerAction, configurationId: string) => void
  runner: UserStoryPreviewRunner
}) {
  return runner.runtime?.configurations.map((configuration) => (
    <PreviewConfigurationItem
      key={configuration.id}
      configuration={configuration}
      disabled={runner.pending}
      status={runner.runtime?.statuses[configuration.id] ?? "stopped"}
      onSelect={() => onSelect("start", configuration.id)}
    />
  ))
}

function PreviewConfigurationItem({
  configuration,
  disabled,
  onSelect,
  status,
}: {
  configuration: ProjectRunConfiguration
  disabled: boolean
  onSelect: () => void
  status: ProjectRunConfigurationStatus
}) {
  return (
    <DropdownMenuItem className="gap-2" disabled={disabled} onSelect={onSelect}>
      <RunStatusDot status={status} />
      <RunCategoryIcon category={configuration.category} />
      <span className="flex-1 truncate">{configuration.name}</span>
      <span className="text-xs text-muted-foreground">
        {configuration.category ?? "other"}
      </span>
    </DropdownMenuItem>
  )
}

function PreviewStartButton({
  onStart,
  pending,
  status,
}: {
  onStart: () => void
  pending: boolean
  status: ProjectRunConfigurationStatus
}) {
  const running = status === "running"
  return (
    <Button
      aria-label={
        running
          ? "Restart preview configuration"
          : "Start preview configuration"
      }
      disabled={pending || status === "starting"}
      size="icon-sm"
      type="button"
      variant="ghost"
      onClick={onStart}
    >
      <PreviewStartIcon pending={pending} running={running} />
    </Button>
  )
}

function PreviewStartIcon({
  pending,
  running,
}: {
  pending: boolean
  running: boolean
}) {
  if (pending) return <LoaderCircleIcon className="animate-spin" />
  if (running) return <RotateCwIcon className="text-emerald-500" />
  return <PlayIcon className="text-emerald-500" />
}

function RunStatusDot({ status }: { status: ProjectRunConfigurationStatus }) {
  const tone =
    status === "running"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-destructive"
        : status === "starting"
          ? "animate-pulse bg-amber-500"
          : "bg-muted-foreground/40"
  return <span className={`size-2 shrink-0 rounded-full ${tone}`} />
}

function RunCategoryIcon({
  category,
}: {
  category?: ProjectRunConfigurationCategory
}) {
  const Icon =
    category === "web"
      ? MonitorIcon
      : category === "mobile"
        ? SmartphoneIcon
        : category === "desktop"
          ? AppWindowIcon
          : category === "terminal"
            ? TerminalIcon
            : category === "service"
              ? ServerIcon
              : BoxIcon
  return <Icon className="size-4 shrink-0 text-muted-foreground" />
}

function selectedConfiguration(
  runtime: ProjectPreviewRuntimeState | undefined
) {
  return runtime?.configurations.find(
    ({ id }) => id === runtime.selectedConfigurationId
  )
}
