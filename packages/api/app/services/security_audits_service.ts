import SecurityAudit, { type SecurityAuditSnapshot } from '#models/security_audit'
import UserStory from '#models/user_story'
import ProjectsService from '#services/projects_service'
import { Exception } from '@adonisjs/core/exceptions'
import { DateTime } from 'luxon'

const statuses = new Set([
  'queued',
  'mapping',
  'discovery',
  'validation',
  'prioritization',
  'completed',
  'failed',
  'cancelled',
])
const maxPayloadBytes = 5 * 1024 * 1024

export default class SecurityAuditsService {
  async list(userId: string, projectId: string) {
    await new ProjectsService().findForUser(userId, projectId)
    const audits = await SecurityAudit.query()
      .where('projectId', projectId)
      .orderBy('startedAt', 'desc')
    await this.removeDeletedBacklogLinks(projectId, audits)
    return audits.map((audit) => audit.payload)
  }

  async save(userId: string, projectId: string, auditId: string, value: unknown) {
    await new ProjectsService().findForUser(userId, projectId)
    const snapshot = securityAuditSnapshot(value, projectId, auditId)
    let audit = await SecurityAudit.query()
      .where('projectId', projectId)
      .where('id', auditId)
      .first()
    if (audit && audit.sequence >= snapshot.sequence) return audit.payload
    if (!audit) {
      audit = new SecurityAudit()
      audit.id = auditId
      audit.projectId = projectId
    }
    audit.merge({
      payload: snapshot,
      sequence: snapshot.sequence,
      startedAt: DateTime.fromISO(snapshot.startedAt),
      status: snapshot.status,
    })
    await audit.save()
    await this.removeDeletedBacklogLinks(projectId, [audit])
    return audit.payload
  }

  private async removeDeletedBacklogLinks(projectId: string, audits: SecurityAudit[]) {
    const linkedIds = new Set<string>()
    for (const audit of audits) {
      for (const finding of auditFindings(audit.payload)) {
        if (typeof finding.backlogStoryId === 'string') linkedIds.add(finding.backlogStoryId)
      }
    }
    if (!linkedIds.size) return
    const stories = await UserStory.query()
      .where('projectId', projectId)
      .whereIn('id', [...linkedIds])
      .select('id')
    const existingIds = new Set(stories.map(({ id }) => id))
    await Promise.all(
      audits.map(async (audit) => {
        const payload = withoutDeletedBacklogLinks(audit.payload, existingIds)
        if (payload === audit.payload) return
        audit.payload = payload
        await audit.save()
      })
    )
  }
}

function securityAuditSnapshot(value: unknown, projectId: string, auditId: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidAudit()
  const audit = value as Record<string, unknown>
  if (
    audit.version !== 1 ||
    audit.id !== auditId ||
    !uuid(audit.id) ||
    audit.projectId !== projectId
  )
    invalidAudit()
  if (
    !Number.isSafeInteger(audit.sequence) ||
    Number(audit.sequence) < 0 ||
    Number(audit.sequence) > 4_294_967_295
  )
    invalidAudit()
  if (typeof audit.status !== 'string' || !statuses.has(audit.status)) invalidAudit()
  if (!validDate(audit.startedAt) || !validDate(audit.updatedAt)) invalidAudit()
  if (!Array.isArray(audit.findings)) invalidAudit()
  const serialized = JSON.stringify(audit)
  if (Buffer.byteLength(serialized, 'utf8') > maxPayloadBytes) {
    throw new Exception('Security audit payload is too large', {
      status: 413,
      code: 'E_SECURITY_AUDIT_TOO_LARGE',
    })
  }
  return JSON.parse(serialized) as SecurityAuditSnapshot
}

function withoutDeletedBacklogLinks(audit: SecurityAuditSnapshot, existingIds: Set<string>) {
  let changed = false
  const findings = auditFindings(audit).map((finding) => {
    if (typeof finding.backlogStoryId !== 'string' || existingIds.has(finding.backlogStoryId)) {
      return finding
    }
    changed = true
    const { backlogStoryId, ...withoutLink } = finding
    void backlogStoryId
    return {
      ...withoutLink,
      ...(finding.status === 'fixing' ? { status: 'open' } : {}),
    }
  })
  return changed ? ({ ...audit, findings } as SecurityAuditSnapshot) : audit
}

function auditFindings(audit: SecurityAuditSnapshot) {
  return Array.isArray(audit.findings) ? audit.findings.filter(isRecord) : []
}

function validDate(value: unknown) {
  return typeof value === 'string' && DateTime.fromISO(value).isValid
}

function uuid(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function invalidAudit(): never {
  throw new Exception('Security audit payload is invalid', {
    status: 422,
    code: 'E_SECURITY_AUDIT_INVALID',
  })
}
