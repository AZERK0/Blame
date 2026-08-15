import * as React from "react"
import type {
  RunSecurityAuditInput,
  SecurityAudit,
  SecurityFinding,
  SecurityFindingStatus,
} from "@blame/agent-runtime"

import { useCloudAuth } from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { useProjects } from "@/context/projects"
import { createCloudApi } from "@/lib/cloud-api"

const runningStatuses = new Set<SecurityAudit["status"]>([
  "queued",
  "mapping",
  "discovery",
  "validation",
  "prioritization",
])

type Persistence = { promise: Promise<SecurityAudit>; sequence: number }

export function useSecurityAudits() {
  const auth = useCloudAuth()
  const platform = usePlatform()
  const project = useProjects().activeProject
  const root = project?.path
  const projectId = project?.id
  const runner = platform.securityAudits
  const cloud = React.useMemo(
    () => createCloudApi(auth.apiConnection),
    [auth.apiConnection]
  )
  const persistence = React.useRef(new Map<string, Persistence>())
  const auditsRef = React.useRef<SecurityAudit[]>([])
  const [state, setState] = React.useState<{
    audits: SecurityAudit[]
    error?: string
    loading: boolean
    projectId?: string
    root?: string
  }>({ audits: [], loading: true })

  const applyAudit = React.useCallback(
    (audit: SecurityAudit) => {
      setState((current) => {
        const audits = upsertAudit(
          current.projectId === projectId ? current.audits : [],
          audit
        )
        auditsRef.current = audits
        return {
          ...current,
          audits,
          error: undefined,
          loading: false,
          projectId,
          root,
        }
      })
    },
    [projectId, root]
  )

  const persist = React.useCallback(
    (audit: SecurityAudit) => {
      if (!projectId || audit.projectId !== projectId) {
        return Promise.reject(
          new Error("Security audit project identity is invalid.")
        )
      }
      const key = `${projectId}:${audit.id}`
      const queued = persistence.current.get(key)
      if (queued && queued.sequence >= audit.sequence) return queued.promise
      const promise = (queued?.promise ?? Promise.resolve(audit))
        .catch(() => audit)
        .then(() => cloud.saveSecurityAudit(projectId, audit))
        .then((saved) => {
          applyAudit(saved)
          return saved
        })
      persistence.current.set(key, { promise, sequence: audit.sequence })
      return promise
    },
    [applyAudit, cloud, projectId]
  )

  const load = React.useCallback(async () => {
    if (!root || !projectId || auth.status !== "authenticated") {
      auditsRef.current = []
      setState({
        audits: [],
        error:
          auth.status === "unauthenticated"
            ? "Sign in to access cloud security audits."
            : undefined,
        loading: auth.status === "loading",
        projectId,
        root,
      })
      return
    }
    setState((current) => ({
      ...current,
      error: undefined,
      loading: true,
      projectId,
      root,
    }))
    try {
      let audits = await cloud.securityAudits(projectId)
      if (runner) {
        const active = await runner.active({ root })
        const interrupted = audits.filter(
          (audit) =>
            runningStatuses.has(audit.status) && audit.id !== active?.id
        )
        if (interrupted.length) {
          const replacements = await Promise.all(
            interrupted.map((audit) =>
              cloud.saveSecurityAudit(projectId, interruptedAudit(audit))
            )
          )
          const replacementById = new Map(
            replacements.map((audit) => [audit.id, audit])
          )
          audits = audits.map((audit) => replacementById.get(audit.id) ?? audit)
        }
        if (active) audits = upsertAudit(audits, active)
      }
      auditsRef.current = audits
      setState({ audits, loading: false, projectId, root })
    } catch (error) {
      auditsRef.current = []
      setState({
        audits: [],
        error: errorMessage(error),
        loading: false,
        projectId,
        root,
      })
    }
  }, [auth.status, cloud, projectId, root, runner])

  React.useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  React.useEffect(() => {
    if (!runner || !root) return
    return runner.onChanged((event) => {
      if (event.root !== root) return
      applyAudit(event.audit)
      void persist(event.audit).catch((error) => {
        setState((current) => ({ ...current, error: errorMessage(error) }))
      })
    })
  }, [applyAudit, persist, root, runner])

  const run = React.useCallback(
    async (
      input: Omit<
        RunSecurityAuditInput,
        "cwd" | "previousFindings" | "workspaceRoot"
      >
    ) => {
      if (!runner || !root || !projectId)
        throw new Error("Open a desktop project before running an audit.")
      setState((current) => ({ ...current, error: undefined }))
      try {
        const audit = await runner.run({
          ...input,
          cwd: root,
          projectId,
          previousFindings: auditFindingHistory(auditsRef.current),
          workspaceRoot: root,
        })
        return await persist(audit)
      } catch (error) {
        setState((current) => ({ ...current, error: errorMessage(error) }))
        throw error
      }
    },
    [persist, projectId, root, runner]
  )

  const cancel = React.useCallback(
    async (auditId: string) => {
      if (!runner || !root) throw new Error("Security Audit is unavailable.")
      const audit = await runner.cancel({ root, auditId })
      return audit ? persist(audit) : undefined
    },
    [persist, root, runner]
  )

  const updateFinding = React.useCallback(
    async (
      auditId: string,
      fingerprint: string,
      update: {
        status?: SecurityFindingStatus
        backlogStoryId?: string | null
      }
    ) => {
      const audit = auditsRef.current.find((item) => item.id === auditId)
      if (!audit) throw new Error("Security audit was not found.")
      let found = false
      const findings = audit.findings.map((finding) => {
        if (finding.fingerprint !== fingerprint) return finding
        found = true
        const next: SecurityFinding = { ...finding }
        if (update.status !== undefined) next.status = update.status
        if (update.backlogStoryId === null) delete next.backlogStoryId
        else if (update.backlogStoryId !== undefined)
          next.backlogStoryId = update.backlogStoryId
        return next
      })
      if (!found) throw new Error("Security finding was not found.")
      const next: SecurityAudit = {
        ...audit,
        findings,
        sequence: audit.sequence + 1,
        updatedAt: new Date().toISOString(),
      }
      auditsRef.current = upsertAudit(auditsRef.current, next)
      applyAudit(next)
      return persist(next)
    },
    [applyAudit, persist]
  )

  const audits = state.projectId === projectId ? state.audits : []
  return {
    ...state,
    audits,
    cancel,
    latest: audits[0],
    load,
    project,
    run,
    running: audits.find((audit) => runningStatuses.has(audit.status)),
    updateFinding,
  }
}

function auditFindingHistory(audits: SecurityAudit[]) {
  return audits.flatMap((audit) =>
    audit.findings.map((finding) => ({
      auditId: audit.id,
      fingerprint: finding.fingerprint,
      status: finding.status,
      ...(finding.firstSeenAuditId
        ? { firstSeenAuditId: finding.firstSeenAuditId }
        : {}),
      ...(finding.backlogStoryId
        ? { backlogStoryId: finding.backlogStoryId }
        : {}),
    }))
  )
}

function upsertAudit(audits: SecurityAudit[], audit: SecurityAudit) {
  const current = audits.find((item) => item.id === audit.id)
  const next = current && current.sequence > audit.sequence ? current : audit
  return [next, ...audits.filter((item) => item.id !== audit.id)].sort(
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

function interruptedAudit(audit: SecurityAudit): SecurityAudit {
  const timestamp = new Date().toISOString()
  return {
    ...audit,
    status: "failed",
    error: "The desktop audit process ended before this audit completed.",
    completedAt: timestamp,
    sequence: audit.sequence + 1,
    updatedAt: timestamp,
  }
}
