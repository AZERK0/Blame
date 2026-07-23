import vine from '@vinejs/vine'
import { agentActivity, agentUsage, nullableDateTime } from '#validators/user_story'

const kind = vine.enum(['initial', 'change-request', 'resume'])
const status = vine.enum(['running', 'completed', 'failed'])

export const createQuickChatAgentRunValidator = vine.create({
  messageId: vine.string().trim().uuid().nullable().optional(),
  kind,
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  checkpointRunCount: vine.number().withoutDecimals().positive().nullable().optional(),
  status: status.optional(),
})

export const updateQuickChatAgentRunValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  checkpointRunCount: vine.number().withoutDecimals().positive().nullable().optional(),
  diffEndRef: vine
    .string()
    .trim()
    .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
    .nullable()
    .optional(),
  status: status.optional(),
  activities: vine.array(agentActivity).nullable().optional(),
  agentActivity: agentActivity.nullable().optional(),
  finalResponse: vine.string().nullable().optional(),
  usage: agentUsage.nullable().optional(),
  sessionSummary: vine.string().nullable().optional(),
  completedAt: nullableDateTime,
})
