import * as React from "react"
import type { SecurityAuditMode } from "@blame/agent-runtime"
import { CheckIcon, ScanSearchIcon, ShieldCheckIcon } from "lucide-react"

import { ModelSelector } from "@/components/model/model-selector"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function SecurityLaunchDialog({
  open,
  onOpenChange,
  onRun,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  onRun(mode: SecurityAuditMode): void
}) {
  const [mode, setMode] = React.useState<SecurityAuditMode>("standard")
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Run Security Audit</DialogTitle>
          <DialogDescription>
            Entire project · current working revision
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <ModeCard
            active={mode === "standard"}
            icon={<ShieldCheckIcon />}
            title="Standard"
            description="Code analysis, configuration review, validation, and risk prioritization."
            badge="Recommended"
            onClick={() => setMode("standard")}
          />
          <ModeCard
            active={mode === "deep"}
            icon={<ScanSearchIcon />}
            title="Deep"
            description="Three independent discovery perspectives followed by one canonical validation pass."
            onClick={() => setMode("deep")}
          />
        </div>
        <div className="flex items-center justify-between gap-4 rounded-lg border bg-muted/35 px-3 py-2">
          <div>
            <p className="text-sm font-medium">Analysis model</p>
            <p className="text-xs text-muted-foreground">
              Uses your analysis preference
            </p>
          </div>
          <div className="max-w-64 min-w-0 flex-1">
            <ModelSelector role="alternative" />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false)
              onRun(mode)
            }}
          >
            Run audit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ModeCard({
  active,
  badge,
  description,
  icon,
  onClick,
  title,
}: {
  active: boolean
  badge?: string
  description: string
  icon: React.ReactNode
  onClick(): void
  title: string
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        active
          ? "border-blue-500/50 bg-blue-500/8 ring-1 ring-blue-500/20"
          : "border-foreground/10 hover:bg-muted/50"
      )}
      onClick={onClick}
    >
      <span className="mt-0.5 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 font-medium">
          {title}
          {badge ? (
            <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] text-blue-600 dark:text-blue-300">
              {badge}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
      <span
        className={cn(
          "mt-0.5 flex size-4 items-center justify-center rounded-full border",
          active
            ? "border-blue-500 bg-blue-500 text-white"
            : "border-muted-foreground/40"
        )}
      >
        {active ? <CheckIcon className="size-3" /> : null}
      </span>
    </button>
  )
}
