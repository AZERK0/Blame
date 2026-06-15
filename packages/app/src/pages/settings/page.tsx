import * as React from "react"
import {
  CheckCircle2Icon,
  DownloadIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
} from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { usePlatform, type DesktopUpdateStatus } from "@/context/platform"

const fallbackStatus: DesktopUpdateStatus = {
  currentVersion: "development",
  phase: "unsupported",
  reason: "Updates are available only in the desktop app.",
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure Blame and manage desktop updates.
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto px-6 pb-6">
          <SettingsContent />
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsDialogButton({
  className,
  onClick,
}: {
  className?: string
  onClick(): void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label="Open settings"
      className={className}
      onClick={onClick}
    >
      <Settings2Icon />
    </Button>
  )
}

function SettingsContent() {
  const platform = usePlatform()
  const updates = platform.updates
  const [updateStatus, setUpdateStatus] =
    React.useState<DesktopUpdateStatus>(fallbackStatus)
  const status = updates ? updateStatus : fallbackStatus

  React.useEffect(() => {
    if (!updates) return

    let active = true
    void updates.getStatus().then((nextStatus) => {
      if (active) setUpdateStatus(nextStatus)
    })
    const unsubscribe = updates.onStatus(setUpdateStatus)

    return () => {
      active = false
      unsubscribe()
    }
  }, [updates])

  async function run(action: () => Promise<DesktopUpdateStatus>) {
    setUpdateStatus(await action())
  }

  return (
    <Card className="max-w-3xl">
      <CardHeader>
        <CardTitle>Updates</CardTitle>
        <CardDescription>
          Keep Blame current with the latest desktop release.
        </CardDescription>
        <CardAction>
          <UpdateBadge status={status} />
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-5">
        <VersionGrid status={status} />
        <UpdateMessage status={status} />
        {status.phase === "downloading" ? (
          <DownloadProgress progress={status.progress ?? 0} />
        ) : null}
        <UpdateActions status={status} updates={updates} run={run} />
      </CardContent>
    </Card>
  )
}

function VersionGrid({ status }: { status: DesktopUpdateStatus }) {
  return (
    <div className="grid gap-3 text-sm md:grid-cols-2">
      <VersionRow label="Current version" value={status.currentVersion} />
      <VersionRow
        label="Latest version"
        value={status.latestVersion ?? "Not checked"}
      />
    </div>
  )
}

function UpdateActions({
  status,
  updates,
  run,
}: {
  status: DesktopUpdateStatus
  updates: ReturnType<typeof usePlatform>["updates"]
  run: (action: () => Promise<DesktopUpdateStatus>) => Promise<void>
}) {
  const busy = status.phase === "checking" || status.phase === "downloading"

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={!updates || busy}
        onClick={() => updates && void run(updates.check)}
      >
        <RefreshCwIcon />
        Check for updates
      </Button>
      <Button
        type="button"
        disabled={!updates || status.phase !== "available"}
        onClick={() => updates && void run(updates.download)}
      >
        <DownloadIcon />
        Download update
      </Button>
      <Button
        type="button"
        disabled={!updates || status.phase !== "downloaded"}
        onClick={() => updates && void run(updates.install)}
      >
        <RotateCcwIcon />
        Restart and install
      </Button>
    </div>
  )
}

function VersionRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  )
}

function UpdateBadge({ status }: { status: DesktopUpdateStatus }) {
  if (status.phase === "available") return <Badge>Available</Badge>
  if (status.phase === "downloaded") return <Badge>Ready</Badge>
  if (status.phase === "error") return <Badge variant="destructive">Error</Badge>
  if (status.phase === "unsupported") return <Badge variant="outline">Unavailable</Badge>
  if (status.phase === "checking" || status.phase === "downloading") return <Badge variant="secondary">Working</Badge>
  return <Badge variant="outline">Idle</Badge>
}

function UpdateMessage({ status }: { status: DesktopUpdateStatus }) {
  if (status.phase === "error") {
    return (
      <Alert variant="destructive">
        <AlertTitle>Update check failed</AlertTitle>
        <AlertDescription>{status.error ?? "Unable to check for updates."}</AlertDescription>
      </Alert>
    )
  }

  if (status.phase === "unsupported") {
    return (
      <Alert>
        <AlertTitle>Updates unavailable</AlertTitle>
        <AlertDescription>{status.reason ?? "Updates are unavailable for this build."}</AlertDescription>
      </Alert>
    )
  }

  if (status.phase === "available") {
    return (
      <Alert>
        <AlertTitle>Version {status.latestVersion} is available</AlertTitle>
        <AlertDescription>Download the update when you are ready.</AlertDescription>
      </Alert>
    )
  }

  if (status.phase === "downloaded") {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Update downloaded</AlertTitle>
        <AlertDescription>Restart Blame to install version {status.latestVersion}.</AlertDescription>
      </Alert>
    )
  }

  if (status.phase === "not-available") {
    return (
      <Alert>
        <CheckCircle2Icon />
        <AlertTitle>Blame is up to date</AlertTitle>
        <AlertDescription>No newer desktop release is available.</AlertDescription>
      </Alert>
    )
  }

  return (
    <Alert>
      <AlertTitle>Manual updates</AlertTitle>
      <AlertDescription>Check for updates, then choose when to download and install.</AlertDescription>
    </Alert>
  )
}

function DownloadProgress({ progress }: { progress: number }) {
  const percent = Math.max(0, Math.min(100, progress))

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <span className="font-medium">Downloading update</span>
        <span className="text-muted-foreground">{Math.round(percent)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  )
}
