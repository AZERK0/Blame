import * as React from "react"
import { CheckCircle2Icon, DownloadIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react"

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
import { usePlatform, type DesktopUpdateStatus } from "@/context/platform"

const fallbackStatus: DesktopUpdateStatus = {
  currentVersion: "development",
  phase: "unsupported",
  reason: "Updates are available only in the desktop app.",
}

export function SettingsPage() {
  const platform = usePlatform()
  const updates = platform.updates
  const [status, setStatus] = React.useState<DesktopUpdateStatus>(fallbackStatus)

  React.useEffect(() => {
    if (!updates) {
      setStatus(fallbackStatus)
      return
    }

    let active = true
    void updates.getStatus().then((nextStatus) => {
      if (active) setStatus(nextStatus)
    })
    const unsubscribe = updates.onStatus(setStatus)

    return () => {
      active = false
      unsubscribe()
    }
  }, [updates])

  async function run(action: () => Promise<DesktopUpdateStatus>) {
    setStatus(await action())
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 lg:p-6">
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
          <div className="grid gap-3 text-sm md:grid-cols-2">
            <VersionRow label="Current version" value={status.currentVersion} />
            <VersionRow label="Latest version" value={status.latestVersion ?? "Not checked"} />
          </div>
          <UpdateMessage status={status} />
          {status.phase === "downloading" ? (
            <DownloadProgress progress={status.progress ?? 0} />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={!updates || status.phase === "checking" || status.phase === "downloading"}
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
        </CardContent>
      </Card>
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
