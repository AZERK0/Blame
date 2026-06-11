import type {
  AssessProjectInitializationImpactResult,
  ProjectRunConfiguration,
  RepairProjectInitializationResult,
} from "@blame/agent-runtime"

import type { useCloudAuth } from "@/context/cloud-auth"
import type { usePlatform } from "@/context/platform"
import { createCloudApi } from "@/lib/cloud-api"
import { notifyProjectInitializationUpdated } from "@/components/project-initialization/project-initialization-events"

type ImpactInput = {
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"]
  platform: ReturnType<typeof usePlatform>
  projectId: string
  providerId: string
  modelId: string
  credentialLabel?: string
  reasoningEffort?: "low" | "medium" | "high" | "xhigh"
  repositoryRoot: string
  baseCommit: string
  mergeCommit: string
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
  const repair = await repairProjectInitializationImpact(
    input,
    initialization,
    assessment
  )
  await persistProjectInitializationRepair(input, repair)
  return { assessment, repair }
}

async function currentInitialization(input: ImpactInput) {
  const snapshot = await createCloudApi(
    input.apiConnection
  ).projectInitialization(input.projectId)
  const initialization = snapshot.initialization
  if (!initialization?.setupScript || !initialization.dockerCompose) {
    return undefined
  }
  return {
    setupScript: initialization.setupScript,
    dockerCompose: initialization.dockerCompose,
    runConfigurations: initialization.runConfigurations,
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
    setupScript: initialization.setupScript,
    dockerCompose: initialization.dockerCompose,
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
  return agent.initializations.repair({
    apiConnection: input.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialLabel: input.credentialLabel,
    reasoningEffort: input.reasoningEffort,
    cwd: input.repositoryRoot,
    workspaceRoot: input.repositoryRoot,
    setupScript: initialization.setupScript,
    dockerCompose: initialization.dockerCompose,
    runConfigurations: initialization.runConfigurations,
    diagnostics: assessment.diagnostics,
  })
}

async function persistProjectInitializationRepair(
  input: ImpactInput,
  result: RepairProjectInitializationResult
) {
  if (result.classification !== "repairable_initialization") return
  if (
    !result.setupScript ||
    !result.dockerCompose ||
    !result.runConfigurations
  ) {
    throw new Error(
      "Initialization repair agent returned incomplete artifacts."
    )
  }
  await createCloudApi(input.apiConnection).repairProjectInitialization(
    input.projectId,
    {
      clineSessionId: result.sessionId,
      setupScript: result.setupScript,
      dockerCompose: result.dockerCompose,
      runConfigurations: result.runConfigurations,
      reason: result.reason,
    }
  )
  notifyProjectInitializationUpdated(input.projectId)
}

type CurrentInitialization = {
  setupScript: string
  dockerCompose: string
  runConfigurations: ProjectRunConfiguration[]
}
