import * as React from "react"
import type {
  RunSecurityAuditInput,
  SecurityAudit,
  SecurityFindingStatus,
} from "@blame/agent-runtime"

import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"

const runningStatuses = new Set<SecurityAudit["status"]>([
  "queued",
  "mapping",
  "discovery",
  "validation",
  "prioritization",
])

export function useSecurityAudits() {
  const platform = usePlatform()
  const project = useProjects().activeProject
  const root = project?.path
  const client = platform.securityAudits
  const [state, setState] = React.useState<{
    audits: SecurityAudit[]
    error?: string
    loading: boolean
    root?: string
  }>({ audits: [], loading: true })

  const load = React.useCallback(async () => {
    if (!root || !client) {
      setState({
        audits: [],
        error: client
          ? undefined
          : "Security Audit is available in the desktop app.",
        loading: false,
        root,
      })
      return
    }
    setState((current) => ({
      ...current,
      error: undefined,
      loading: true,
      root,
    }))
    try {
      const audits = await client.list({ root })
      setState({ audits, loading: false, root })
    } catch (error) {
      setState({ audits: [], error: errorMessage(error), loading: false, root })
    }
  }, [client, root])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  React.useEffect(() => {
    if (!client || !root) return
    return client.onChanged((event) => {
      if (event.root !== root) return
      setState((current) => ({
        ...current,
        error: undefined,
        loading: false,
        root,
        audits: upsertAudit(
          current.root === root ? current.audits : [],
          event.audit
        ),
      }))
    })
  }, [client, root])

  const run = React.useCallback(
    async (input: Omit<RunSecurityAuditInput, "cwd" | "workspaceRoot">) => {
      if (!client || !root)
        throw new Error("Open a desktop project before running an audit.")
      setState((current) => ({ ...current, error: undefined }))
      try {
        return await client.run({ ...input, cwd: root, workspaceRoot: root })
      } catch (error) {
        setState((current) => ({ ...current, error: errorMessage(error) }))
        throw error
      }
    },
    [client, root]
  )

  const updateFinding = React.useCallback(
    async (
      auditId: string,
      fingerprint: string,
      update: { status?: SecurityFindingStatus; backlogStoryId?: string }
    ) => {
      if (!client || !root) throw new Error("Security Audit is unavailable.")
      return client.updateFinding({ root, auditId, fingerprint, ...update })
    },
    [client, root]
  )

  const audits = state.root === root ? state.audits : []
  return {
    ...state,
    audits,
    latest: audits[0],
    load,
    project,
    run,
    running: audits.find((audit) => runningStatuses.has(audit.status)),
    updateFinding,
  }
}

function upsertAudit(audits: SecurityAudit[], audit: SecurityAudit) {
  return [audit, ...audits.filter((item) => item.id !== audit.id)].sort(
    (left, right) => right.startedAt.localeCompare(left.startedAt)
  )
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Unable to run the security audit."
}

export function securityAuditRunning(audit?: SecurityAudit) {
  return Boolean(audit && runningStatuses.has(audit.status))
}
