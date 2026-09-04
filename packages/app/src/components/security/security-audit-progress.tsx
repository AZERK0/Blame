import type {
  SecurityAudit,
  SecurityAuditProgressStep,
  SecurityAuditStatus,
} from "@blame/agent-runtime"
import { LoaderCircleIcon, SquareIcon } from "lucide-react"

import {
  TaskProgress,
  TaskProgressHeader,
  TaskProgressIcon,
  type TaskProgressItem,
} from "@/components/shared/task-progress"
import { Button } from "@/components/ui/button"

const phases: { status: SecurityAuditStatus; label: string }[] = [
  { status: "queued", label: "Preparing audit" },
  { status: "mapping", label: "Mapping attack surface" },
  { status: "discovery", label: "Analyzing project" },
  { status: "validation", label: "Validating findings" },
  { status: "prioritization", label: "Prioritizing risk" },
  { status: "completed", label: "Generating report" },
]

type SecurityAuditProgressProps = {
  audit: SecurityAudit
  cancelling: boolean
  onCancel(): void
}

export function SecurityAuditProgress({
  audit,
  cancelling,
  onCancel,
}: SecurityAuditProgressProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-8 sm:px-6 sm:py-12">
      <div className="my-auto w-full max-w-xl self-center rounded-xl border bg-card p-5 sm:p-6">
        <TaskProgressHeader
          title="Auditing your project"
          description={`${audit.mode === "deep" ? "Deep audit" : "Standard audit"} · read-only`}
          status="running"
          statusLabel={cancelling ? "Stopping…" : "Running"}
        />
        <TaskProgress steps={auditProgressSteps(audit)} />
        <AuditMetrics audit={audit} />
        <AuditStopButton cancelling={cancelling} onCancel={onCancel} />
      </div>
    </div>
  )
}

function auditProgressSteps(audit: SecurityAudit): TaskProgressItem[] {
  const current = Math.max(
    0,
    phases.findIndex(
      ({ status }) => status === (audit.progress?.phase ?? audit.status)
    )
  )
  return phases.map((phase, index) => ({
    id: phase.status,
    label: phase.label,
    status:
      index < current ? "completed" : index === current ? "running" : "pending",
    detail: audit.progress?.steps.length ? (
      <div className="space-y-1">
        {audit.progress.steps.map((step) => (
          <AuditSubstep key={step.id} step={step} />
        ))}
      </div>
    ) : undefined,
  }))
}

function AuditSubstep({ step }: { step: SecurityAuditProgressStep }) {
  return (
    <div className="flex min-h-8 items-start gap-2 py-1">
      <TaskProgressIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <p className="text-xs">{step.label}</p>
        {step.detail && (
          <p className="mt-0.5 text-xs break-words text-muted-foreground">
            {step.detail}
          </p>
        )}
      </div>
    </div>
  )
}

function AuditMetrics({ audit }: { audit: SecurityAudit }) {
  return (
    <div className="mt-5 grid grid-cols-3 gap-2 border-t pt-4 text-center">
      <Metric value={audit.surfaceMap?.fileCount ?? "—"} label="files mapped" />
      <Metric value={audit.candidateCount || "—"} label="potential issues" />
      <Metric value={audit.mode === "deep" ? 3 : 1} label="investigators" />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="font-heading text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
}

function AuditStopButton({
  cancelling,
  onCancel,
}: Pick<SecurityAuditProgressProps, "cancelling" | "onCancel">) {
  return (
    <div className="mt-5 flex justify-center border-t pt-4">
      <Button
        variant="outline"
        className="text-destructive hover:text-destructive"
        disabled={cancelling}
        onClick={onCancel}
      >
        {cancelling ? (
          <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
        ) : (
          <SquareIcon />
        )}
        {cancelling ? "Stopping audit…" : "Stop audit"}
      </Button>
    </div>
  )
}
