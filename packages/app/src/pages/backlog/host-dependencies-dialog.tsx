import { DownloadIcon, RefreshCwIcon } from "lucide-react"

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
} from "@/context/platform"
import { usePlatform } from "@/context/platform"
import { cn } from "@/lib/utils"

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

  function openDownload(issue: HostDependencyIssue) {
    const url = dependencyUrl(issue)
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
            <div
              key={`${issue.name}-${issue.status}`}
              className="grid gap-3 rounded-lg border bg-muted/20 p-3 sm:grid-cols-[1fr_auto] sm:items-center"
            >
              <div className="min-w-0">
                <div className="font-medium">{dependencyLabel(issue)}</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {issue.message} {issue.action}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => openDownload(issue)}
              >
                <DownloadIcon />
                {dependencyButtonLabel(issue)}
              </Button>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={checking}
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

function dependencyLabel(issue: HostDependencyIssue) {
  const labels: Record<HostDependencyIssue["name"], string> = {
    corepack: "Corepack",
    docker: "Docker",
    "docker-compose": "Docker Compose",
    "docker-daemon": "Docker daemon",
    git: "Git",
    node: "Node.js 22+",
    npm: "npm",
    pnpm: "pnpm",
    yarn: "Yarn",
    bun: "Bun",
    pip: "pip",
  }
  return labels[issue.name]
}

function dependencyButtonLabel(issue: HostDependencyIssue) {
  if (issue.name === "docker-daemon") return "Open Docker"
  if (issue.status === "unsupported") return "Upgrade"
  return "Download"
}

function dependencyUrl(issue: HostDependencyIssue) {
  const urls: Record<HostDependencyIssue["name"], string> = {
    corepack: "https://nodejs.org/en/download",
    docker: "https://www.docker.com/products/docker-desktop/",
    "docker-compose": "https://docs.docker.com/compose/install/",
    "docker-daemon": "https://www.docker.com/products/docker-desktop/",
    git: "https://git-scm.com/downloads",
    node: "https://nodejs.org/en/download",
    npm: "https://nodejs.org/en/download",
    pnpm: "https://pnpm.io/installation",
    yarn: "https://yarnpkg.com/getting-started/install",
    bun: "https://bun.sh/docs/installation",
    pip: "https://packaging.python.org/en/latest/tutorials/installing-packages/",
  }
  return urls[issue.name]
}
