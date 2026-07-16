import * as React from "react"

import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"
import {
  notifyCodePracticeAnalysisUpdated,
  subscribeCodePracticeAnalysisUpdated,
} from "@/components/practices/data/code-practice-analysis-events"

export function useCodePracticeAnalysis() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const projectId = projects.activeProject?.id
  const [state, setState] = React.useState<AnalysisState>()
  const current = state && state.projectId === projectId ? state.analysis : undefined

  React.useEffect(() => {
    if (!projectId || auth.status !== "authenticated") return
    let cancelled = false
    const api = createCloudApi(auth.apiConnection)
    const refresh = async () => {
      const analysis = await api.projectCodePracticeAnalysis(projectId)
      if (!cancelled) setState({ analysis, projectId })
    }
    void refresh().catch(() => undefined)
    const unsubscribe = subscribeCodePracticeAnalysisUpdated(
      projectId,
      () => void refresh().catch(() => undefined)
    )
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [auth.apiConnection, auth.status, projectId])

  return current
}

export function useMarkCodePracticeAnalysisViewed(
  analysis: ReturnType<typeof useCodePracticeAnalysis>
) {
  const auth = useCloudAuth()
  const projectId = useProjects().activeProject?.id

  React.useEffect(() => {
    if (!projectId || analysis?.status !== "done" || analysis.viewedAt) return
    const api = createCloudApi(auth.apiConnection)
    void api
      .markProjectCodePracticeAnalysisViewed(projectId)
      .then(() => notifyCodePracticeAnalysisUpdated(projectId))
      .catch(() => undefined)
  }, [analysis?.status, analysis?.viewedAt, auth.apiConnection, projectId])
}

type AnalysisState = {
  analysis: Awaited<
    ReturnType<ReturnType<typeof createCloudApi>["projectCodePracticeAnalysis"]>
  >
  projectId: string
}
