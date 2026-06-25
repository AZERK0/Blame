import { cn } from "@/lib/utils"

export function shortGitHash(hash: string) {
  return hash.slice(0, 9)
}

export function gitRefClassName(type: string) {
  if (type === "head")
    return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400"
  if (type === "tag")
    return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
  if (type === "remote")
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  return "border-muted-foreground/20 bg-muted text-muted-foreground"
}

export function gitStatusClassName(status: string) {
  return cn(
    "h-5 w-8 justify-center px-0 font-mono text-[0.68rem]",
    status === "added" &&
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    status === "deleted" &&
      "border-destructive/30 bg-destructive/10 text-destructive",
    status === "renamed" &&
      "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    status === "untracked" &&
      "border-cyan-500/30 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
    status === "conflict" &&
      "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400",
    status === "modified" &&
      "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
  )
}

export function gitStatusLabel(status: string) {
  if (status === "added") return "A"
  if (status === "deleted") return "D"
  if (status === "renamed") return "R"
  if (status === "untracked") return "?"
  if (status === "conflict") return "!"
  return "M"
}

export function gitDateLabel(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(date)
}

export function gitRelativeDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const diff = date.getTime() - Date.now()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (Math.abs(diff) < hour)
    return relative(Math.round(diff / minute), "minute")
  if (Math.abs(diff) < day) return relative(Math.round(diff / hour), "hour")
  return relative(Math.round(diff / day), "day")
}

function relative(value: number, unit: Intl.RelativeTimeFormatUnit) {
  return new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }).format(
    value,
    unit
  )
}
