import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function CapabilityRow({
  enabled,
  label,
}: {
  enabled: boolean
  label: string
}) {
  return (
    <SettingsRow
      title={label}
      description={enabled ? "Available" : "Unavailable"}
    >
      <Badge variant={enabled ? "secondary" : "outline"}>
        {enabled ? "Ready" : "Missing"}
      </Badge>
    </SettingsRow>
  )
}

export function SettingsPanel({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-5 py-6">{children}</div>
}

export function SettingsGroup({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description: string
  title: string
}) {
  return (
    <section>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div>{children}</div>
    </section>
  )
}

export function SettingsRow({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description: string
  title: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex min-w-0 shrink-0 items-center gap-2 sm:justify-end">
        {children}
      </div>
    </div>
  )
}

export function StatusText({
  title,
  tone,
}: {
  title: string
  tone: "muted" | "success"
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          "size-2 rounded-full",
          tone === "success" ? "bg-emerald-500" : "bg-muted-foreground"
        )}
      />
      <span className="font-medium">{title}</span>
    </div>
  )
}

export function EmptySettingsState({ message }: { message: string }) {
  return (
    <div className="border-b py-8 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}
