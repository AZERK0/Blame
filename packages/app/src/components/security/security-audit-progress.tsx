import type {
  SecurityAudit,
  SecurityAuditProgressStep,
  SecurityAuditStatus,
} from "@blame/agent-runtime"
import {
  CheckIcon,
  CircleIcon,
  LoaderCircleIcon,
  SquareIcon,
  XIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const phases: { status: SecurityAuditStatus; label: string }[] = [
  { status: "queued", label: "Preparing audit" },
  { status: "mapping", label: "Mapping attack surface" },
  { status: "discovery", label: "Analyzing project" },
  { status: "validation", label: "Validating findings" },
  { status: "prioritization", label: "Prioritizing risk" },
  { status: "completed", label: "Generating report" },
]

export function SecurityAuditProgress({
  audit,
  cancelling,
  onCancel,
}: {
  audit: SecurityAudit
  cancelling: boolean
  onCancel(): void
}) {
  const phaseStatus = audit.progress?.phase ?? audit.status
  const currentIndex = Math.max(
    0,
    phases.findIndex(({ status }) => status === phaseStatus)
  )
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-xl rounded-xl border bg-card p-5 shadow-sm sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <p className="font-heading text-xl font-semibold">Security Audit</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {audit.mode === "deep" ? "Deep audit" : "Standard audit"} ·
              read-only
            </p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300">
            <span className="size-2 animate-pulse rounded-full bg-blue-500" />
            Running
          </span>
        </div>
        <div className="space-y-1">
          {phases.map((phase, index) => {
            const active = index === currentIndex
            const complete = index < currentIndex
            return (
              <div
                key={phase.status}
                className={cn(
                  "rounded-lg border border-transparent px-2 py-2.5 transition-colors",
                  active && "border-blue-500/20 bg-blue-500/5"
                )}
              >
                <div className="flex items-center gap-3">
                  <PhaseIcon complete={complete} active={active} />
                  <span
                    className={cn(
                      "flex-1",
                      index <= currentIndex
                        ? "text-foreground"
                        : "text-muted-foreground",
                      active && "font-medium"
                    )}
                  >
                    {phase.label}
                  </span>
                  {complete ? (
                    <span className="text-[11px] text-muted-foreground">
                      Complete
                    </span>
                  ) : null}
                </div>
                {active && audit.progress?.steps.length ? (
                  <div className="mt-2 ml-2 space-y-1 border-l pl-5">
                    {audit.progress.steps.map((step) => (
                      <ProgressStep key={step.id} step={step} />
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 border-t pt-4 text-center">
          <Metric
            value={audit.surfaceMap?.fileCount ?? "—"}
            label="files mapped"
          />
          <Metric
            value={audit.candidateCount || "—"}
            label="potential issues"
          />
          <Metric value={audit.mode === "deep" ? 3 : 1} label="investigators" />
        </div>
        <div className="mt-5 flex justify-center border-t pt-4">
          <Button
            variant="outline"
            className="text-destructive hover:text-destructive"
            disabled={cancelling}
            onClick={onCancel}
          >
            {cancelling ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SquareIcon />
            )}
            {cancelling ? "Stopping audit…" : "Stop audit"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ProgressStep({ step }: { step: SecurityAuditProgressStep }) {
  return (
    <div className="flex min-h-8 items-start gap-2 py-1">
      {step.status === "completed" ? (
        <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
      ) : step.status === "running" ? (
        <LoaderCircleIcon className="mt-0.5 size-3.5 shrink-0 animate-spin text-blue-500" />
      ) : step.status === "failed" || step.status === "cancelled" ? (
        <XIcon className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      ) : (
        <CircleIcon className="mt-1 size-2.5 shrink-0 text-muted-foreground/50" />
      )}
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-xs",
            step.status === "pending"
              ? "text-muted-foreground"
              : "text-foreground"
          )}
        >
          {step.label}
        </p>
        {step.detail ? (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {step.detail}
          </p>
        ) : null}
      </div>
    </div>
  )
}

function PhaseIcon({
  complete,
  active,
}: {
  complete: boolean
  active: boolean
}) {
  if (complete) {
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <CheckIcon className="size-3.5" />
      </span>
    )
  }
  if (active)
    return <LoaderCircleIcon className="size-5 animate-spin text-blue-500" />
  return (
    <span className="size-5 rounded-full border border-muted-foreground/25" />
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-heading text-lg font-semibold">{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  )
}
