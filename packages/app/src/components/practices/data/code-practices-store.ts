import * as React from "react"

import { createCodePracticesApi } from "@/components/practices/data/code-practices-api"
import type {
  CodePractice,
  CodePracticeKey,
} from "@/components/practices/data/code-practices-data"
import { useCloudAuth } from "@/context/cloud-auth"
import { useProjects } from "@/context/projects"
import { subscribeCodePracticeAnalysisUpdated } from "@/components/practices/data/code-practice-analysis-events"

type CodePracticesState = {
  error?: string
  loading: boolean
  practices: CodePractice[]
  updatingPractice: CodePracticeKey | null
}

export function useCodePracticesStore() {
  const auth = useCloudAuth()
  const projects = useProjects()
  const projectId = projects.activeProject?.id
  const [state, setState] = React.useState<CodePracticesState>({
    loading: false,
    practices: [],
    updatingPractice: null,
  })
  const api = React.useMemo(
    () => createCodePracticesApi(auth.apiConnection),
    [auth.apiConnection]
  )

  const load = React.useCallback(async () => {
    if (!projectId) {
      setState({
        loading: false,
        practices: [],
        updatingPractice: null,
      })
      return
    }

    setState((current) => ({ ...current, error: undefined, loading: true }))
    try {
      setState({
        loading: false,
        practices: await api.list(projectId),
        updatingPractice: null,
      })
    } catch (error) {
      setState({
        error:
          error instanceof Error
            ? error.message
            : "Unable to load code practices.",
        loading: false,
        practices: [],
        updatingPractice: null,
      })
    }
  }, [api, projectId])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  React.useEffect(() => {
    if (!projectId) return
    return subscribeCodePracticeAnalysisUpdated(projectId, () => void load())
  }, [load, projectId])

  const updateEnabled = React.useCallback(
    async (practice: CodePractice, enabled: boolean) => {
      if (!projectId)
        throw new Error("Open a project before updating code practices.")

      const previousPractice = practice
      setState((current) => ({
        ...current,
        error: undefined,
        practices: current.practices.map((currentPractice) =>
          currentPractice.practice === practice.practice
            ? { ...currentPractice, enabled }
            : currentPractice
        ),
        updatingPractice: practice.practice,
      }))

      try {
        const updatedPractice = await api.update(projectId, practice.practice, {
          enabled,
        })
        setState((current) => ({
          ...current,
          practices: current.practices.map((currentPractice) =>
            currentPractice.practice === updatedPractice.practice
              ? updatedPractice
              : currentPractice
          ),
          updatingPractice: null,
        }))
      } catch (error) {
        setState((current) => ({
          ...current,
          error:
            error instanceof Error
              ? error.message
              : "Unable to update code practice.",
          practices: current.practices.map((currentPractice) =>
            currentPractice.practice === previousPractice.practice
              ? previousPractice
              : currentPractice
          ),
          updatingPractice: null,
        }))
      }
    },
    [api, projectId]
  )

  return {
    ...state,
    load,
    projectId,
    updateEnabled,
  }
}
