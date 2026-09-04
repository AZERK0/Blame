import type { ReactNode } from "react"
import { CheckIcon, LoaderCircleIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export type TaskProgressStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
export type TaskProgressItem = {
  id: string
  label: string
  description?: string
  status: TaskProgressStatus
  detail?: ReactNode
}

type TaskProgressHeaderProps = {
  title: string
  description: string
  status: "running" | "completed" | "failed"
  statusLabel: string
}

export function TaskProgressHeader({
  title,
  description,
  status,
  statusLabel,
}: TaskProgressHeaderProps) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 flex-1 basis-48">
        <h3 className="font-heading text-xl font-semibold break-words">
          {title}
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <span
        role="status"
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium",
          status === "failed" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        <TaskProgressIcon status={status} />
        {statusLabel}
      </span>
    </div>
  )
}

export function TaskProgress({ steps }: { steps: TaskProgressItem[] }) {
  return (
    <ol className="space-y-1">
      {steps.map((step) => (
        <TaskProgressRow key={step.id} step={step} />
      ))}
    </ol>
  )
}

function TaskProgressRow({ step }: { step: TaskProgressItem }) {
  const active = step.status === "running"
  return (
    <li
      aria-current={active ? "step" : undefined}
      className={cn(
        "rounded-lg border border-transparent px-3 py-3",
        active && "border-primary/20 bg-primary/5"
      )}
    >
      <TaskProgressRowContent step={step} />
      {active && step.detail && (
        <div className="mt-2 ml-2 border-l pl-5">{step.detail}</div>
      )}
    </li>
  )
}

export function TaskProgressIcon({ status }: { status: TaskProgressStatus }) {
  if (status === "completed")
    return (
      <CheckIcon
        aria-hidden="true"
        className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400"
      />
    )
  if (status === "running")
    return (
      <LoaderCircleIcon
        aria-hidden="true"
        className="size-5 shrink-0 animate-spin text-primary motion-reduce:animate-none"
      />
    )
  if (status === "failed" || status === "cancelled")
    return (
      <XIcon aria-hidden="true" className="size-5 shrink-0 text-destructive" />
    )
  return (
    <span
      aria-hidden="true"
      className="size-5 shrink-0 rounded-full border border-muted-foreground/30"
    />
  )
}

function TaskProgressRowContent({ step }: { step: TaskProgressItem }) {
  const active = step.status === "running"
  return (
    <div className="flex items-start gap-3">
      <TaskProgressIcon status={step.status} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "text-sm",
            step.status === "pending" && "text-muted-foreground",
            active && "font-medium"
          )}
        >
          {step.label}
          <span className="sr-only"> · {step.status}</span>
        </p>
        {step.description && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {step.description}
          </p>
        )}
      </div>
      {step.status === "completed" && (
        <span className="text-xs text-muted-foreground">Complete</span>
      )}
    </div>
  )
}
