import type { CloudProject } from "@/context/cloud-auth"

type BackendProject = {
  id: string
  name?: string
  worktree?: string
  icon?: {
    color?: string
  }
}

export type Project = {
  id: string
  name: string
  path: string
  repositoryFingerprint?: string | null
  initials: string
  color: string
  branch?: string
}

const colors = [
  "bg-fuchsia-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
]

const colorValues = {
  "bg-fuchsia-500": "oklch(66.7% 0.295 322.15)",
  "bg-pink-500": "oklch(65.6% 0.241 354.31)",
  "bg-indigo-500": "oklch(58.5% 0.233 277.12)",
  "bg-blue-500": "oklch(62.3% 0.214 259.81)",
  "bg-emerald-500": "oklch(69.6% 0.17 162.48)",
  "bg-amber-500": "oklch(76.9% 0.188 70.08)",
} as const

export function createProject(
  path: string,
  backend?: BackendProject,
  cloud?: CloudProject
): Project {
  const name = backend?.name || projectName(backend?.worktree ?? path)
  return {
    id: cloud?.id ?? backend?.id ?? crypto.randomUUID(),
    name,
    repositoryFingerprint: cloud?.repositoryFingerprint ?? backend?.id ?? null,
    path: backend?.worktree ?? path,
    initials: projectInitials(name),
    color:
      colorClass(backend?.icon?.color) ?? colors[hash(path) % colors.length],
  }
}

export function projectName(path: string) {
  return (
    path
      .replace(/[/\\]+$/, "")
      .split(/[/\\]/)
      .at(-1) || path
  )
}

export function projectColorValue(color?: string) {
  if (!color) return colorValues["bg-fuchsia-500"]
  return color in colorValues
    ? colorValues[color as keyof typeof colorValues]
    : colorValues["bg-fuchsia-500"]
}

function projectInitials(name: string) {
  const parts = name
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)

  if (parts.length === 0) return "P"
  return parts.map((part) => part[0]?.toUpperCase()).join("")
}

function hash(value: string) {
  return Array.from(value).reduce(
    (result, char) => (result * 31 + char.charCodeAt(0)) >>> 0,
    0
  )
}

function colorClass(color?: string) {
  if (!color) return
  if (color.startsWith("bg-")) return color
  if (color === "purple") return "bg-fuchsia-500"
  if (color === "cyan") return "bg-blue-500"
  if (color === "mint") return "bg-emerald-500"
  if (color === "orange") return "bg-amber-500"
  if (color === "pink") return "bg-pink-500"
  if (color === "lime") return "bg-lime-500"
}
