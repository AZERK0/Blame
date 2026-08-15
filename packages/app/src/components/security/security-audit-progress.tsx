import type { SecurityAudit, SecurityAuditStatus } from "@blame/agent-runtime"
import { CheckIcon, LoaderCircleIcon } from "lucide-react"

const phases: { status: SecurityAuditStatus; label: string }[] = [
  { status: "mapping", label: "Mapping attack surface" },
  { status: "discovery", label: "Analyzing project" },
  { status: "validation", label: "Validating findings" },
  { status: "prioritization", label: "Prioritizing risk" },
  { status: "completed", label: "Generating report" },
]

export function SecurityAuditProgress({ audit }: { audit: SecurityAudit }) {
  const currentIndex = Math.max(
    0,
    phases.findIndex(({ status }) => status === audit.status)
  )
  return (
    <div className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="font-heading text-xl font-semibold">Security Audit</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {audit.mode === "deep" ? "Deep audit" : "Standard audit"} ·
              read-only
            </p>
          </div>
          <span className="inline-flex items-center gap-2 text-sm font-medium text-blue-600 dark:text-blue-300">
            <span className="size-2 animate-pulse rounded-full bg-blue-500" />
            Running
          </span>
        </div>
        <div className="space-y-1">
          {phases.map((phase, index) => (
            <div
              key={phase.status}
              className="flex items-center gap-3 rounded-lg px-2 py-2.5"
            >
              <PhaseIcon
                complete={index < currentIndex}
                active={index === currentIndex}
              />
              <span
                className={
                  index <= currentIndex
                    ? "text-foreground"
                    : "text-muted-foreground"
                }
              >
                {phase.label}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2 border-t pt-4 text-center">
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
