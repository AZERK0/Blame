import * as React from "react"
import { DownloadIcon, LoaderCircleIcon, RefreshCwIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import type {
  HostDependencyIssue,
  HostDependencyReport,
  RuntimeDiagnosticInput,
} from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { cn } from "@/lib/utils"
import {
  runtimeFailureDetail,
  runtimeFailureTitle,
  runtimeReportFailure,
} from "@/pages/backlog/runtime-failure"

const runtimeFailureToastId = "runtime-action-failure"

export type HostDependenciesDialogProps = {
  checking: boolean
  onOpenChange(open: boolean): void
  onRecheck(): Promise<void>
  open: boolean
  report?: HostDependencyReport
  storyTitle?: string
}

export function HostDependenciesDialog({
  checking,
  onOpenChange,
  onRecheck,
  open,
  report,
  storyTitle,
}: HostDependenciesDialogProps) {
  const platform = usePlatform()
  const issues = report?.issues ?? []
  const [runningAction, setRunningAction] = React.useState<string | null>(null)
  const busy = checking || Boolean(runningAction)

  async function runDependencyAction(issue: HostDependencyIssue) {
    const runtimeAction = dependencyRuntimeAction(issue, platform)
    if (runtimeAction) {
      setRunningAction(`${issue.name}-${issue.status}`)
      try {
        const result = await runtimeAction.run()
        const reportFailure = runtimeReportFailure(result)
        if (reportFailure) {
          showRuntimeFailureToast(
            reportFailure,
            runtimeAction.operation,
            platform
          )
          return
        }
        await onRecheck()
      } catch (error) {
        showRuntimeFailureToast(error, runtimeAction.operation, platform)
      } finally {
        setRunningAction(null)
      }
      return
    }
    const url = dependencyUrl(issue)
    if (!url) return
    if (platform.openExternalLink) platform.openExternalLink(url)
    else window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Missing development requirements</DialogTitle>
          <DialogDescription>
            Blame needs these host tools before it can start development
            {storyTitle ? ` for ${storyTitle}` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {issues.map((issue) => (
            <DependencyIssueRow
              key={`${issue.name}-${issue.status}`}
              issue={issue}
              disabled={busy}
              loading={runningAction === `${issue.name}-${issue.status}`}
              platform={platform}
              onAction={runDependencyAction}
            />
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void onRecheck()}
          >
            <RefreshCwIcon className={cn(checking && "animate-spin")} />
            {checking ? "Checking" : "Recheck"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DependencyIssueRow({
  disabled,
  issue,
  loading,
  onAction,
  platform,
}: {
  disabled: boolean
  issue: HostDependencyIssue
  loading: boolean
  onAction(issue: HostDependencyIssue): Promise<void>
  platform: ReturnType<typeof usePlatform>
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <div className="font-medium">{dependencyLabel(issue)}</div>
        <div className="mt-1 text-sm text-muted-foreground">
          {issue.message} {issue.action}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => void onAction(issue)}
      >
        <DependencyButtonIcon
          issue={issue}
          loading={loading}
          platform={platform}
        />
        {loading ? "Preparing" : dependencyButtonLabel(issue, platform)}
      </Button>
    </div>
  )
}

function DependencyButtonIcon({
  issue,
  loading,
  platform,
}: {
  issue: HostDependencyIssue
  loading: boolean
  platform: ReturnType<typeof usePlatform>
}) {
  if (loading) return <LoaderCircleIcon className="animate-spin" />
  if (dependencyRuntimeAction(issue, platform)) return <RefreshCwIcon />
  return <DownloadIcon />
}

function dependencyRuntimeAction(
  issue: HostDependencyIssue,
  platform: ReturnType<typeof usePlatform>
) {
  if (!managedRuntimePlatform(platform.platform)) return null
  if (issue.name === "blame-runtime") return blameRuntimeAction(issue, platform)
  if (runtimeRepairDependency(issue.name)) {
    return createRuntimeAction("repair", platform.workspace?.repairRuntime)
  }
  return null
}

function blameRuntimeAction(
  issue: HostDependencyIssue,
  platform: ReturnType<typeof usePlatform>
) {
  if (resetRuntimeIssue(issue)) {
    return createRuntimeAction("reset", platform.workspace?.resetRuntime)
  }
  return createRuntimeAction("ensure", platform.workspace?.ensureRuntimeReady)
}

function createRuntimeAction(
  operation: RuntimeDiagnosticInput["operation"],
  run: (() => Promise<unknown>) | undefined
) {
  return run ? { operation, run } : null
}

function resetRuntimeIssue(issue: HostDependencyIssue) {
  return /\breset\b/i.test(issue.action)
}

function managedRuntimePlatform(platform?: string) {
  return platform === "darwin" || platform === "win32"
}

function containerRuntimeDependency(name: HostDependencyIssue["name"]) {
  return ["containerd", "nerdctl", "nerdctl-compose"].includes(name)
}

function runtimeRepairDependency(name: HostDependencyIssue["name"]) {
  return name === "cline-sdk" || containerRuntimeDependency(name)
}

function dependencyButtonLabel(
  issue: HostDependencyIssue,
  platform: ReturnType<typeof usePlatform>
) {
  if (dependencyRuntimeAction(issue, platform)) {
    if (resetRuntimeIssue(issue)) return "Reset Runtime"
    return issue.name === "blame-runtime" ? "Setup Runtime" : "Repair Runtime"
  }
  if (issue.status === "unsupported") return "Upgrade"
  return "Download"
}

function dependencyLabel(issue: HostDependencyIssue) {
  const labels: Record<HostDependencyIssue["name"], string> = {
    "blame-runtime": "Blame Runtime",
    "cline-sdk": "Cline SDK",
    containerd: "containerd",
    corepack: "Corepack",
    git: "Git",
    nerdctl: "nerdctl",
    "nerdctl-compose": "nerdctl compose",
    node: "Node.js 22+",
    npm: "npm",
    pnpm: "pnpm",
    yarn: "Yarn",
    bun: "Bun",
    pip: "pip",
  }
  return labels[issue.name]
}

function dependencyUrl(issue: HostDependencyIssue) {
  const urls: Record<HostDependencyIssue["name"], string> = {
    "blame-runtime": "https://blame.dev",
    "cline-sdk": "https://blame.dev",
    containerd: "https://containerd.io/",
    corepack: "https://nodejs.org/en/download",
    git: "https://git-scm.com/downloads",
    nerdctl: "https://github.com/containerd/nerdctl",
    "nerdctl-compose": "https://github.com/containerd/nerdctl/blob/main/docs/compose.md",
    node: "https://nodejs.org/en/download",
    npm: "https://nodejs.org/en/download",
    pnpm: "https://pnpm.io/installation",
    yarn: "https://yarnpkg.com/getting-started/install",
    bun: "https://bun.sh/docs/installation",
    pip: "https://packaging.python.org/en/latest/tutorials/installing-packages/",
  }
  return urls[issue.name]
}

function showRuntimeFailureToast(
  error: unknown,
  operation: RuntimeDiagnosticInput["operation"],
  platform: ReturnType<typeof usePlatform>
) {
  const detail = runtimeFailureDetail(error)
  const send = platform.telemetry?.sendRuntimeDiagnostic
  toast.error(runtimeFailureTitle(operation), {
    action: send
      ? {
          label: "Send diagnostic",
          onClick: () =>
            void submitRuntimeDiagnostic({ detail, operation }, platform),
        }
      : undefined,
    description: detail,
    duration: Infinity,
    id: runtimeFailureToastId,
  })
}

async function submitRuntimeDiagnostic(
  input: RuntimeDiagnosticInput,
  platform: ReturnType<typeof usePlatform>
) {
  try {
    const sent = await platform.telemetry?.sendRuntimeDiagnostic?.(input)
    if (!sent) {
      showDiagnosticSendFailure()
      return
    }
    toast.dismiss(runtimeFailureToastId)
    toast.success("Runtime diagnostic sent", {
      description: "The error details were sent to Blame for investigation.",
    })
  } catch {
    showDiagnosticSendFailure()
  }
}

function showDiagnosticSendFailure() {
  toast.error("Unable to send runtime diagnostic", {
    description: "Check your connection and sign-in status, then try again.",
  })
}
