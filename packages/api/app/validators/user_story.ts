import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const status = vine.enum(['backlog', 'ready', 'in-progress', 'in-review', 'done', 'discarded'])
const priority = vine.enum(['Low', 'Medium', 'High'])
const agentStatus = vine.enum(['Running', 'Paused'])
const agentActivityKind = vine.enum(['reasoning', 'tool', 'approval', 'notice'])
const agentActivityStatus = vine.enum(['running', 'completed', 'failed'])
const agentActivity = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  kind: agentActivityKind,
  title: vine.string().trim().minLength(1).maxLength(255),
  detail: vine.string().maxLength(32768),
  status: agentActivityStatus.optional(),
  iteration: vine.number().optional(),
  toolCallId: vine.string().trim().maxLength(255).optional(),
  createdAt: vine.string().trim().minLength(1).maxLength(255),
  updatedAt: vine.string().trim().maxLength(255).optional(),
})
const nullableDateTime = vine
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((value, field): DateTime | null | undefined => {
    if (value === null || value === undefined) return value
    const date = DateTime.fromISO(value)
    if (date.isValid) return date
    const sqlDate = DateTime.fromSQL(value)
    if (sqlDate.isValid) return sqlDate
    field.report('The {{ field }} field must be a datetime value', 'date', field)
    return DateTime.invalid('Invalid datetime')
  })

export const listUserStoriesValidator = vine.create({
  projectId: vine.string().trim().minLength(1),
})

export const createUserStoryValidator = vine.create({
  projectId: vine.string().trim().minLength(1),
  title: vine.string().trim().minLength(1).maxLength(255),
  summary: vine.string(),
  status: status.optional(),
  priority: priority.optional(),
  owner: vine.string().trim().minLength(1).maxLength(255).optional(),
  branch: vine.string().trim().maxLength(255).nullable().optional(),
  previewUrl: vine.string().trim().maxLength(2048).nullable().optional(),
  worktree: vine.string().trim().maxLength(2048).nullable().optional(),
  agentStatus: agentStatus.nullable().optional(),
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  agentProviderId: vine.string().trim().maxLength(80).nullable().optional(),
  agentModelId: vine.string().trim().maxLength(255).nullable().optional(),
  agentLastEvent: vine.string().trim().maxLength(4096).nullable().optional(),
  agentLastError: vine.string().trim().maxLength(4096).nullable().optional(),
  agentActivities: vine.array(agentActivity).nullable().optional(),
  agentFinalResponse: vine.string().nullable().optional(),
  mergedAt: nullableDateTime,
  mergeCommit: vine.string().trim().maxLength(255).nullable().optional(),
  discardedReason: vine.string().trim().maxLength(2048).nullable().optional(),
})

export const updateUserStoryValidator = vine.create({
  projectId: vine.string().trim().minLength(1).optional(),
  title: vine.string().trim().minLength(1).maxLength(255).optional(),
  summary: vine.string().optional(),
  status: status.optional(),
  priority: priority.optional(),
  owner: vine.string().trim().minLength(1).maxLength(255).optional(),
  branch: vine.string().trim().maxLength(255).nullable().optional(),
  previewUrl: vine.string().trim().maxLength(2048).nullable().optional(),
  worktree: vine.string().trim().maxLength(2048).nullable().optional(),
  agentStatus: agentStatus.nullable().optional(),
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  agentProviderId: vine.string().trim().maxLength(80).nullable().optional(),
  agentModelId: vine.string().trim().maxLength(255).nullable().optional(),
  agentLastEvent: vine.string().trim().maxLength(4096).nullable().optional(),
  agentLastError: vine.string().trim().maxLength(4096).nullable().optional(),
  agentActivities: vine.array(agentActivity).nullable().optional(),
  agentFinalResponse: vine.string().nullable().optional(),
  mergedAt: nullableDateTime,
  mergeCommit: vine.string().trim().maxLength(255).nullable().optional(),
  discardedReason: vine.string().trim().maxLength(2048).nullable().optional(),
})
