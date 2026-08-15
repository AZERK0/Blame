import * as React from "react"
import type {
  DeployConnection,
  DeployProject,
  DeployTarget,
  DeploymentManifest,
  DeploymentSnapshot,
  ProjectDeployment,
} from "@blame/deploy-contract"
import type { ProjectRunConfiguration } from "@blame/agent-runtime"
import { toast } from "sonner"

import type { CloudProjectInitialization } from "@/context/cloud-auth"
import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform, type DeployProgress } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { CloudApiError, createCloudApi } from "@/lib/cloud-api"

const activeStatuses = new Set([
  "packaging",
  "uploading_source",
  "transferring_to_vercel",
  "submitted",
  "building",
  "verifying_public_access",
  "canceling",
])

export type LocalDeployPreflight = {
  manifest: DeploymentManifest
  snapshot: DeploymentSnapshot
  excludedFileCount: number
}

export function useDeployPage() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const { activeProject } = useProjects()
  const api = React.useMemo(
    () => createCloudApi(auth.apiConnection),
    [auth.apiConnection]
  )
  const [connections, setConnections] = React.useState<DeployConnection[]>([])
  const [connectionId, setConnectionId] = React.useState<string>()
  const [target, setTarget] = React.useState<DeployTarget | null>(null)
  const [deployments, setDeployments] = React.useState<ProjectDeployment[]>([])
  const [initialization, setInitialization] =
    React.useState<CloudProjectInitialization | null>(null)
  const [preflight, setPreflight] = React.useState<LocalDeployPreflight>()
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string>()
  const [connecting, setConnecting] = React.useState(false)
  const [deploying, setDeploying] = React.useState(false)
  const [progress, setProgress] = React.useState<DeployProgress>()
  const [providerProjects, setProviderProjects] = React.useState<
    DeployProject[]
  >([])
  const [projectsLoading, setProjectsLoading] = React.useState(false)
  const [logs, setLogs] = React.useState<
    Array<{ created: number; message: string }>
  >([])
  const [logsLoading, setLogsLoading] = React.useState(false)
  const connectDeadline = React.useRef(0)
  const projectId = activeProject?.id
  const projectPath = activeProject?.path

  const sourceInput = React.useCallback(
    (value: CloudProjectInitialization | null) => {
      if (!projectPath || !value?.previewManifest) return null
      return {
        root: projectPath,
        previewManifest: value.previewManifest,
        runConfigurations: value.runConfigurations as ProjectRunConfiguration[],
      }
    },
    [projectPath]
  )

  const runPreflight = React.useCallback(
    async (value: CloudProjectInitialization | null) => {
      const input = sourceInput(value)
      if (!platform.deploy || !input) {
        setPreflight(undefined)
        return undefined
      }
      const result = await platform.deploy.preflight(input)
      setPreflight(result)
      return result
    },
    [platform.deploy, sourceInput]
  )

  const refresh = React.useCallback(async () => {
    if (!projectId) {
      setLoading(false)
      return
    }
    setError(undefined)
    try {
      const [
        connectionResult,
        targetResult,
        deploymentResult,
        initializationResult,
      ] = await Promise.all([
        api.vercelConnections(),
        api.deployTarget(projectId),
        api.deployments(projectId),
        api.projectInitialization(projectId),
      ])
      const availableConnections = connectionResult.connections.filter(
        ({ status }) => status === "active"
      )
      setConnections(connectionResult.connections)
      setTarget(targetResult.target)
      setDeployments(deploymentResult.deployments)
      setConnectionId((current) =>
        availableConnections.some(({ id }) => id === current)
          ? current
          : (targetResult.target?.connectionId ?? availableConnections[0]?.id)
      )
      setInitialization(initializationResult.initialization)
      if (initializationResult.initialization?.status === "done") {
        await runPreflight(initializationResult.initialization)
      } else {
        setPreflight(undefined)
      }
    } catch (cause) {
      setError(message(cause, "Deployment information could not be loaded."))
    } finally {
      setLoading(false)
    }
  }, [api, projectId, runPreflight])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0)
    return () => window.clearTimeout(timer)
  }, [refresh])

  React.useEffect(() => {
    if (!connecting) return
    const poll = window.setInterval(() => {
      if (Date.now() >= connectDeadline.current) {
        setConnecting(false)
        return
      }
      void api
        .vercelConnections()
        .then(({ connections: next }) => {
          const active = next.filter(({ status }) => status === "active")
          setConnections(next)
          if (!active.length) return
          setConnectionId(active[0]?.id)
          setConnecting(false)
          toast.success("Vercel connected.")
          void refresh()
        })
        .catch(() => undefined)
    }, 2_000)
    return () => window.clearInterval(poll)
  }, [api, connecting, refresh])

  const latest = deployments[0]
  React.useEffect(() => {
    if (!projectId || !latest || !activeStatuses.has(latest.status)) return
    const poll = window.setInterval(() => {
      void api
        .deployment(projectId, latest.id)
        .then(({ deployment }) => {
          setDeployments((current) => replaceDeployment(current, deployment))
        })
        .catch(() => undefined)
    }, 2_500)
    return () => window.clearInterval(poll)
  }, [api, latest, projectId])

  const connect = React.useCallback(async () => {
    setConnecting(true)
    try {
      const intent = await api.vercelConnectIntent()
      connectDeadline.current = Math.min(
        Date.parse(intent.expiresAt),
        Date.now() + 5 * 60_000
      )
      platform.openExternalLink?.(intent.url)
    } catch (cause) {
      setConnecting(false)
      toast.error(message(cause, "Vercel connection could not be started."))
    }
  }, [api, platform])

  const loadProviderProjects = React.useCallback(
    async (selectedConnectionId = connectionId) => {
      if (!selectedConnectionId) return
      setProjectsLoading(true)
      try {
        const result = await api.vercelProjects(selectedConnectionId)
        setProviderProjects(result.projects)
      } catch (cause) {
        toast.error(message(cause, "Vercel projects could not be loaded."))
      } finally {
        setProjectsLoading(false)
      }
    },
    [api, connectionId]
  )

  const saveTarget = React.useCallback(
    async (
      input: {
        connectionId: string
        providerProjectId: string | null
        providerProjectName: string
      },
      manifestOverride = preflight?.manifest
    ) => {
      if (!projectId || !manifestOverride)
        throw new Error("Run deployment preflight first.")
      const result = await api.saveDeployTarget(projectId, {
        ...input,
        manifest: manifestOverride,
      })
      setTarget(result.target)
      setConnectionId(result.target.connectionId)
      return result.target
    },
    [api, preflight, projectId]
  )

  const ensureTarget = React.useCallback(
    async (preflightOverride = preflight) => {
      if (!connectionId || !activeProject || !preflightOverride) return null
      try {
        return await saveTarget(
          {
            connectionId,
            providerProjectId:
              target?.connectionId === connectionId
                ? target.providerProjectId
                : null,
            providerProjectName:
              target?.connectionId === connectionId
                ? target.providerProjectName
                : normalizedProjectName(activeProject.name),
          },
          preflightOverride.manifest
        )
      } catch (cause) {
        if (cause instanceof CloudApiError && cause.status === 409) return null
        throw cause
      }
    },
    [activeProject, connectionId, preflight, saveTarget, target]
  )

  const startDeployment = React.useCallback(
    async (selectedTarget: DeployTarget, preflightOverride = preflight) => {
      const input = sourceInput(initialization)
      if (!platform.deploy || !projectId || !preflightOverride || !input) return
      setDeploying(true)
      setProgress({ phase: "preparing", percent: 0 })
      try {
        const deployment = await platform.deploy.start(
          {
            ...input,
            projectId,
            targetId: selectedTarget.id,
            operationId: crypto.randomUUID(),
            expectedWorkspaceHash: preflightOverride.snapshot.workspaceHash,
          },
          setProgress
        )
        setDeployments((current) => replaceDeployment(current, deployment))
        toast.success("Production deployment submitted to Vercel.")
      } catch (cause) {
        if (
          cause instanceof Error &&
          cause.message.includes("DEPLOY_WORKSPACE_CHANGED")
        ) {
          await runPreflight(initialization)
          toast.error(
            "The workspace changed. Review the updated deployment summary."
          )
        } else {
          toast.error(message(cause, "Deployment could not be submitted."))
        }
        await refresh()
      } finally {
        setDeploying(false)
        setProgress(undefined)
      }
    },
    [
      initialization,
      platform.deploy,
      preflight,
      projectId,
      refresh,
      runPreflight,
      sourceInput,
    ]
  )

  const cancel = React.useCallback(
    async (deployment: ProjectDeployment) => {
      if (!projectId) return
      try {
        const result = await api.cancelDeployment(projectId, deployment.id)
        setDeployments((current) =>
          replaceDeployment(current, result.deployment)
        )
      } catch (cause) {
        toast.error(message(cause, "Deployment could not be cancelled."))
      }
    },
    [api, projectId]
  )

  const loadLogs = React.useCallback(
    async (deployment: ProjectDeployment) => {
      if (!projectId) return
      setLogsLoading(true)
      setLogs([])
      try {
        setLogs((await api.deploymentLogs(projectId, deployment.id)).logs)
      } catch (cause) {
        toast.error(message(cause, "Build logs could not be loaded."))
      } finally {
        setLogsLoading(false)
      }
    },
    [api, projectId]
  )

  return {
    activeProject,
    cancel,
    connect,
    connecting,
    connectionId,
    connections,
    deploying,
    deployments,
    ensureTarget,
    error,
    initialization,
    latest,
    loading,
    loadLogs,
    loadProviderProjects,
    logs,
    logsLoading,
    openExternal: (url: string) => platform.openExternalLink?.(url),
    preflight,
    progress,
    projectsLoading,
    providerProjects,
    refreshPreflight: () => runPreflight(initialization),
    saveTarget,
    setConnectionId,
    startDeployment,
    target,
  }
}

export function normalizedProjectName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/-{2,}/g, "-")
      .slice(0, 100) || "blame-project"
  )
}

function replaceDeployment(
  deployments: ProjectDeployment[],
  deployment: ProjectDeployment
) {
  return [
    deployment,
    ...deployments.filter(({ id }) => id !== deployment.id),
  ].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)
  )
}

function message(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback
}
