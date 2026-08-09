export function workspaceSourceMode(baseline?: { match?: "exact" | "cache" }) {
  return baseline && baseline.match !== "cache" ? ("delta" as const) : ("full" as const)
}
