import * as React from "react"
import { toast } from "sonner"

import { useModelSelection } from "@/components/model/model-selection"
import { notifyCodePracticeAnalysisUpdated } from "@/components/practices/data/code-practice-analysis-events"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

const toastId = "project-code-practices"

export function ProjectCodePracticesRunner() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const selection = useModelSelection({ role: "alternative" })
  const project = useProjects().activeProject

  useCodePracticeAnalysisEffect({
    agent: platform.agent,
    apiConnection: auth.apiConnection,
    authStatus: auth.status,
    model: selection.currentModel,
    project,
    reasoningEffort: selection.currentVariant,
  })
  return null
}

function useCodePracticeAnalysisEffect(selection: AnalysisSelection) {
  const { agent, apiConnection, authStatus, model, project, reasoningEffort } =
    selection
  React.useEffect(() => {
    const input = analysisInput({
      agent,
      apiConnection,
      authStatus,
      model,
      project,
      reasoningEffort,
    })
    if (!input) return
    return startCodePracticeAnalysis(input)
  }, [agent, apiConnection, authStatus, model, project, reasoningEffort])
}

function startCodePracticeAnalysis(input: Omit<AnalysisInput, "signal">) {
  const controller = new AbortController()
  void maybeAnalyzeProjectCodePractices({ ...input, signal: controller.signal })
  return () => controller.abort()
}

type AnalysisSelection = {
  agent: ReturnType<typeof usePlatform>["agent"]
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"]
  authStatus: ReturnType<typeof useCloudAuth>["status"]
  model: ReturnType<typeof useModelSelection>["currentModel"]
  project: ReturnType<typeof useProjects>["activeProject"]
  reasoningEffort: ReturnType<typeof useModelSelection>["currentVariant"]
}

type AnalysisInput = {
  agent: NonNullable<ReturnType<typeof usePlatform>["agent"]>
  apiConnection: ReturnType<typeof useCloudAuth>["apiConnection"]
  credentialLabel?: string
  modelId: string
  project: { id: string; path: string }
  providerId: string
  reasoningEffort: ReturnType<typeof useModelSelection>["currentVariant"]
  signal: AbortSignal
}

function analysisInput(
  selection: AnalysisSelection
): Omit<AnalysisInput, "signal"> | undefined {
  const { agent, apiConnection, authStatus, model, project, reasoningEffort } =
    selection
  if (!project || !model || !agent) return
  if (authStatus !== "authenticated") return
  return {
    agent,
    apiConnection,
    credentialLabel: model.credentialLabel,
    modelId: model.id,
    project,
    providerId: model.provider.id,
    reasoningEffort,
  }
}

async function maybeAnalyzeProjectCodePractices(input: AnalysisInput) {
  const cloud = createCloudApi(input.apiConnection)
  try {
    const analysis = await cloud.projectCodePracticeAnalysis(input.project.id)
    if (analysisCompleted(input, analysis.status)) return
    await cloud.startProjectCodePracticeAnalysis(input.project.id, {
      providerId: input.providerId,
      modelId: input.modelId,
    })
    notifyCodePracticeAnalysisUpdated(input.project.id)
    await analyzeAndPersist(input, cloud)
  } catch (error) {
    if (!input.signal.aborted) await persistAnalysisError(input, cloud, error)
  } finally {
    notifyCodePracticeAnalysisUpdated(input.project.id)
  }
}

function analysisCompleted(input: AnalysisInput, status: string) {
  return input.signal.aborted || status === "running" || status === "done"
}

async function analyzeAndPersist(
  input: AnalysisInput,
  cloud: ReturnType<typeof createCloudApi>
) {
  const result = await input.agent.codePractices.run({
    apiConnection: input.apiConnection,
    providerId: input.providerId,
    modelId: input.modelId,
    credentialLabel: input.credentialLabel,
    reasoningEffort: input.reasoningEffort,
    cwd: input.project.path,
    workspaceRoot: input.project.path,
  })
  await cloud.completeProjectCodePracticeAnalysis(input.project.id, {
    clineSessionId: result.sessionId,
    practices: result.practices,
  })
}

async function persistAnalysisError(
  input: AnalysisInput,
  cloud: ReturnType<typeof createCloudApi>,
  error: unknown
) {
  await cloud
    .failProjectCodePracticeAnalysis(input.project.id, {
      error: errorMessage(error),
    })
    .catch(() => undefined)
  toast.error("Code practice analysis failed", {
    description: errorMessage(error),
    id: toastId,
    position: "bottom-right",
  })
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to analyze code practices"
}
