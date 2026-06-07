import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const kind = vine.enum(['initial', 'change-request', 'resume'])
const status = vine.enum(['running', 'completed', 'failed'])
const agentActivityKind = vine.enum(['reasoning', 'tool', 'approval', 'notice'])
const agentActivityStatus = vine.enum(['running', 'completed', 'failed'])
const agentActivity = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  kind: agentActivityKind,
  title: vine.string().trim().minLength(1).maxLength(255),
  detail: vine.string().maxLength(262144),
  status: agentActivityStatus.optional(),
  iteration: vine.number().optional(),
  toolCallId: vine.string().trim().maxLength(255).optional(),
  detailArtifact: vine.string().trim().maxLength(2048).optional(),
  detailTruncated: vine.boolean().optional(),
  originalDetailLength: vine.number().optional(),
  createdAt: vine.string().trim().minLength(1).maxLength(255),
  updatedAt: vine.string().trim().maxLength(255).optional(),
})
const agentUsageTool = vine.object({
  count: vine.number(),
  maxBytes: vine.number(),
  name: vine.string().trim().minLength(1).maxLength(255),
  totalBytes: vine.number(),
  truncatedCount: vine.number(),
})
const agentUsage = vine.object({
  cacheReadTokens: vine.number(),
  cacheWriteTokens: vine.number(),
  compactionCount: vine.number(),
  currentInputTokens: vine.number().optional(),
  currentOutputTokens: vine.number().optional(),
  currentTotalTokens: vine.number().optional(),
  inputTokens: vine.number(),
  largeFileReads: vine.number(),
  maxContextTokens: vine.number(),
  outputTokens: vine.number(),
  rawTotalTokens: vine.number().optional(),
  sessionTotalTokens: vine.number().optional(),
  unboundedFileReads: vine.number(),
  tokensSavedEstimate: vine.number(),
  topTools: vine.array(agentUsageTool),
  totalCost: vine.number(),
  truncatedOutputs: vine.number(),
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
