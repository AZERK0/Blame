import type {
  PreviewManifest,
  ProjectInitializationDatabaseMode,
  ProjectInitializationImpactDiagnostics,
  ProjectRunConfiguration,
} from "@blame/agent-runtime"

type CurrentInitialization = {
  previewManifest: PreviewManifest
  runConfigurations: ProjectRunConfiguration[]
  databaseMode: ProjectInitializationDatabaseMode | null
}

export type ProjectPreviewRepairCandidate = {
  databaseMode: ProjectInitializationDatabaseMode
  previewManifest: PreviewManifest
  reason: string
  repairSessionId: string
  runConfigurations: ProjectRunConfiguration[]
  sourceTree: string
}

export function parseProjectPreviewRepairCandidate(text: string) {
  const value = JSON.parse(text) as Record<string, unknown>
  if (!validCandidateMetadata(value)) return undefined
  if (!value.previewManifest || typeof value.previewManifest !== "object") {
    return undefined
  }
  if (!Array.isArray(value.runConfigurations)) return undefined
  return value as ProjectPreviewRepairCandidate
}

export function previewRepairCandidateMatchesDiff(diff: string) {
  return diff.trim().length === 0
}

function validCandidateMetadata(value: Record<string, unknown>) {
  return (
    (value.databaseMode === "existing" || value.databaseMode === "compose") &&
    typeof value.reason === "string" &&
    typeof value.repairSessionId === "string" &&
    typeof value.sourceTree === "string" &&
    /^[a-f0-9]{40,64}$/u.test(value.sourceTree)
  )
}

export function databaseModeForInitializationRepair(
  initialization: CurrentInitialization,
  diagnostics: ProjectInitializationImpactDiagnostics | undefined
) {
  if (initialization.databaseMode) return initialization.databaseMode
  if (manifestHasDatabaseService(initialization.previewManifest)) {
    return "compose" as const
  }
  if (!diagnostics) return undefined
  const beforeHasDatabase = hasDatabaseEvidence(
    Object.values(diagnostics.strategicFilesBefore)
  )
  const afterHasDatabase = hasDatabaseEvidence(
    Object.values(diagnostics.strategicFilesAfter)
  )
  if (!beforeHasDatabase && afterHasDatabase) return "compose" as const
  if (beforeHasDatabase) return "existing" as const
  return undefined
}

function manifestHasDatabaseService(manifest: PreviewManifest) {
  return manifest.services.some(
    ({ id, container }) =>
      databaseEvidencePattern.test(id) ||
      databaseEvidencePattern.test(
        "image" in container
          ? (container.image ?? "")
          : (container.build?.dockerfile ?? "")
      )
  )
}

function hasDatabaseEvidence(values: string[]) {
  return values.some((value) => databaseEvidencePattern.test(value))
}

const databaseEvidencePattern =
  /\b(postgres(?:ql)?|mysql|mariadb|mongodb|cockroachdb|database_url|prisma|drizzle)\b/i
