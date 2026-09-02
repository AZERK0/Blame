import type {
  AssessProjectInitializationImpactResult,
  PreviewManifest,
  ProjectInitializationDatabaseMode,
  ProjectRunConfiguration,
  ReasoningSelection,
  RepairProjectInitializationResult,
} from "@blame/agent-runtime"

import type { useCloudAuth } from "@/context/cloud-auth"
import type { usePlatform } from "@/context/platform"
import { createCloudApi } from "@/lib/cloud-api"
import { notifyProjectInitializationUpdated } from "@/components/project-initialization/project-initialization-events"
import { databaseModeForInitializationRepair } from "./project-initialization-database"
import { previewRepairCandidateMatchesDiff } from "./project-initialization-database"
import type { ProjectPreviewRepairCandidate } from "./project-initialization-database"

type ImpactInput = {
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"]
  platform: ReturnType<typeof usePlatform>
  projectId: string
  providerId: string
  modelId: string
  credentialLabel?: string
  reasoningEffort?: ReasoningSelection
  repositoryRoot: string
  baseCommit: string
  mergeCommit: string
  previewRepairCandidate?: ProjectPreviewRepairCandidate
}

export type ProjectInitializationImpactRepairResult = {
  assessment: AssessProjectInitializationImpactResult
  repair?: RepairProjectInitializationResult
}

export async function assessAndRepairProjectInitializationImpact(
  input: ImpactInput
): Promise<ProjectInitializationImpactRepairResult | undefined> {
  const initialization = await currentInitialization(input)
  if (!initialization) return undefined
  const assessment = await assessProjectInitializationImpact(
    input,
    initialization
  )
  if (assessment.classification !== "initialization_update_required") {
    return { assessment }
  }
  const candidate = await matchingPreviewRepairCandidate(input)
  if (candidate) {
    const repair = candidateRepairResult(candidate)
    await persistProjectInitializationRepair(
      input,
      repair,
      candidate.databaseMode
    )
    return { assessment, repair }
  }
  const repair = await repairProjectInitializationImpact(
    input,
    initialization,
    assessment
  )
  const databaseMode = databaseModeForInitializationRepair(
    initialization,
    assessment.diagnostics
  )
  await persistProjectInitializationRepair(input, repair, databaseMode)
  return { assessment, repair }
}

async function matchingPreviewRepairCandidate(input: ImpactInput) {
  const candidate = input.previewRepairCandidate
  const workspace = input.platform.workspace
  if (!candidate || !workspace) return undefined
  const diff = await workspace.gitDiffBetween({
    from: candidate.sourceTree,
    root: input.repositoryRoot,
    to: input.mergeCommit,
  })
  return previewRepairCandidateMatchesDiff(diff) ? candidate : undefined
}

function candidateRepairResult(
  candidate: ProjectPreviewRepairCandidate
): RepairProjectInitializationResult {
  return {
    sessionId: candidate.repairSessionId,
    classification: "repairable_initialization",
    reason: candidate.reason,
    previewManifest: candidate.previewManifest,
    runConfigurations: candidate.runConfigurations,
  }
}

async function currentInitialization(input: ImpactInput) {
  const snapshot = await createCloudApi(
    input.apiConnection
  ).projectInitialization(input.projectId)
  const initialization = snapshot.initialization
  if (!initialization?.previewManifest) return undefined
  return {
    previewManifest: initialization.previewManifest,
    runConfigurations: initialization.runConfigurations,
    databaseMode: initialization.databaseMode,
  }
}

async function assessProjectInitializationImpact(
  input: ImpactInput,
  initialization: CurrentInitialization
) {
  const agent = input.platform.agent
  if (!agent) throw new Error("Initialization impact runtime is unavailable.")
  return agent.initializations.assessImpact({
    apiConnection: input.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialLabel: input.credentialLabel,
    reasoningEffort: input.reasoningEffort,
    cwd: input.repositoryRoot,
    workspaceRoot: input.repositoryRoot,
    baseCommit: input.baseCommit,
    mergeCommit: input.mergeCommit,
    previewManifest: initialization.previewManifest,
    runConfigurations: initialization.runConfigurations,
  })
}

async function repairProjectInitializationImpact(
  input: ImpactInput,
  initialization: CurrentInitialization,
  assessment: AssessProjectInitializationImpactResult
) {
  const agent = input.platform.agent
  if (!agent) throw new Error("Initialization repair runtime is unavailable.")
  if (!assessment.diagnostics) {
    throw new Error(
      "Initialization impact assessment did not include diagnostics."
    )
  }
  const databaseMode = databaseModeForInitializationRepair(
    initialization,
    assessment.diagnostics
  )
  return agent.initializations.repair({
    apiConnection: input.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialLabel: input.credentialLabel,
    reasoningEffort: input.reasoningEffort,
    cwd: input.repositoryRoot,
    workspaceRoot: input.repositoryRoot,
    previewManifest: initialization.previewManifest,
    runConfigurations: initialization.runConfigurations,
    preferences: databaseMode
      ? { database: { mode: databaseMode } }
      : undefined,
    diagnostics: assessment.diagnostics,
  })
}

async function persistProjectInitializationRepair(
  input: ImpactInput,
  result: RepairProjectInitializationResult,
  databaseMode: ProjectInitializationDatabaseMode | undefined
) {
  if (result.classification !== "repairable_initialization") return
  if (!result.previewManifest || !result.runConfigurations) {
    throw new Error(
      "Initialization repair agent returned incomplete artifacts."
    )
  }
  await createCloudApi(input.apiConnection).repairProjectInitialization(
    input.projectId,
    {
      clineSessionId: result.sessionId,
      previewManifest: result.previewManifest,
      runConfigurations: result.runConfigurations,
      databaseMode: databaseMode ?? null,
      reason: result.reason,
    }
  )
  notifyProjectInitializationUpdated(input.projectId)
}

type CurrentInitialization = {
  previewManifest: PreviewManifest
  runConfigurations: ProjectRunConfiguration[]
  databaseMode: ProjectInitializationDatabaseMode | null
}
