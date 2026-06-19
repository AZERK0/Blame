import type {
  PreviewManifest,
  ProjectRunConfiguration,
  RepairProjectInitializationResult,
} from "@blame/agent-runtime"
import { repairKnownProjectInitializationFailure } from "@blame/agent-runtime"

import type { useCloudAuth } from "@/context/cloud-auth"
import type { usePlatform } from "@/context/platform"
import { createCloudApi } from "@/lib/cloud-api"
import { notifyProjectInitializationUpdated } from "@/components/project-initialization/project-initialization-events"

type RepairInput = {
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"]
  platform: ReturnType<typeof usePlatform>
  projectId: string
  providerId: string
  modelId: string
  credentialLabel?: string
  reasoningEffort?: "low" | "medium" | "high" | "xhigh"
  worktree: string
  previewManifest?: PreviewManifest | null
  setupScript: string
  dockerCompose: string
  runConfigurations: ProjectRunConfiguration[]
  launchError: string
}

export async function diagnoseAndRepairProjectInitialization(
  input: RepairInput
): Promise<RepairProjectInitializationResult> {
  const result = await diagnoseProjectInitialization(input)
  if (result.classification !== "repairable_initialization") return result
  await persistProjectInitializationRepair(input, result)
  return result
}

async function diagnoseProjectInitialization(input: RepairInput) {
  const workspace = input.platform.workspace
  const agent = input.platform.agent
  if (!workspace || !agent)
    throw new Error("Initialization repair runtime is unavailable.")
  const diagnostics = await workspace.collectProjectInitializationDiagnostics({
    worktree: input.worktree,
    launchError: input.launchError,
  })
  const knownRepair = repairKnownProjectInitializationFailure({
    diagnostics,
    previewManifest: input.previewManifest ?? undefined,
    setupScript: input.setupScript,
    dockerCompose: input.dockerCompose,
    runConfigurations: input.runConfigurations,
  })
  if (knownRepair) return knownRepair
  const result = await agent.initializations.repair({
    apiConnection: input.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialLabel: input.credentialLabel,
    reasoningEffort: input.reasoningEffort,
    cwd: input.worktree,
    workspaceRoot: input.worktree,
    previewManifest: input.previewManifest ?? undefined,
    setupScript: input.setupScript,
    dockerCompose: input.dockerCompose,
    runConfigurations: input.runConfigurations,
    diagnostics,
  })
  return result
}

async function persistProjectInitializationRepair(
  input: RepairInput,
  result: RepairProjectInitializationResult
) {
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
      previewManifest: result.previewManifest,
      setupScript: result.setupScript,
      dockerCompose: result.dockerCompose,
      runConfigurations: result.runConfigurations,
      reason: result.reason,
    }
  )
  notifyProjectInitializationUpdated(input.projectId)
}
