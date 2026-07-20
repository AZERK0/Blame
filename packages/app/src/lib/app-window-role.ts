export type AppWindowRole = "compact" | "workspace"

export type AppWindowRoleInput = {
  accountPrivacyOpen: boolean
  activeProject: unknown
  aiPreferences: unknown
  authStatus: "authenticated" | "loading" | "unauthenticated"
  licensed: boolean
  statusPipOpen: boolean
}

export function appWindowRole(
  input: AppWindowRoleInput
): AppWindowRole | undefined {
  if (input.statusPipOpen || input.authStatus === "loading") return
  if (input.authStatus === "unauthenticated") return "compact"
  if (input.accountPrivacyOpen) return "compact"
  if (!input.licensed) return "compact"
  if (input.aiPreferences === null) return "compact"
  return input.activeProject ? "workspace" : "compact"
}
