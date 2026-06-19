import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const kind = vine.enum(['initial', 'change-request', 'resume'])
const status = vine.enum(['running', 'completed', 'failed'])
const agentActivityKind = vine.enum(['reasoning', 'message', 'tool', 'approval', 'notice'])
const agentActivityMessageKind = vine.enum(['intermediate', 'final'])
const agentActivityStatus = vine.enum(['running', 'completed', 'failed'])
const agentActivity = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  kind: agentActivityKind,
  title: vine.string().trim().minLength(1).maxLength(255),
  detail: vine.string().maxLength(262144),
  status: agentActivityStatus.optional(),
  iteration: vine.number().optional(),
  messageKind: agentActivityMessageKind.optional(),
  toolCallId: vine.string().trim().maxLength(255).optional(),
  detailArtifact: vine.string().trim().maxLength(2048).optional(),
  detailTruncated: vine.boolean().optional(),
  originalDetailLength: vine.number().optional(),
  createdAt: vine.string().trim().minLength(1).maxLength(255),
  updatedAt: vine.string().trim().maxLength(255).optional(),
})
const agentUsage = vine.object({
  cacheReadTokens: vine.number().optional(),
  cacheWriteTokens: vine.number().optional(),
  cost: vine.number().optional(),
  inputTokens: vine.number(),
  outputTokens: vine.number(),
  totalCacheReadTokens: vine.number().optional(),
  totalCacheWriteTokens: vine.number().optional(),
  totalCost: vine.number().optional(),
  totalInputTokens: vine.number(),
  totalOutputTokens: vine.number(),
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

export const createUserStoryAgentRunValidator = vine.create({
  commentId: vine.number().nullable().optional(),
  kind,
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  status: status.optional(),
})

export const updateUserStoryAgentRunValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  status: status.optional(),
  activities: vine.array(agentActivity).nullable().optional(),
  agentActivity: agentActivity.nullable().optional(),
  finalResponse: vine.string().nullable().optional(),
  usage: agentUsage.nullable().optional(),
  sessionSummary: vine.string().nullable().optional(),
  completedAt: nullableDateTime,
})
