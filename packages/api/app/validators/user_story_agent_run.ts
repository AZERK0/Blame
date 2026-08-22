import vine from '@vinejs/vine'
import { agentActivity, agentUsage, nullableDateTime } from '#validators/user_story'

const kind = vine.enum(['initial', 'change-request', 'resume'])
const status = vine.enum(['running', 'completed', 'failed'])
const terminalStatus = vine.enum(['completed', 'failed'])
const finalizationOutcome = vine.enum(['review', 'paused'])
const diffEndRef = vine
  .string()
  .trim()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
  .nullable()
  .optional()

export const createUserStoryAgentRunValidator = vine.create({
  commentId: vine.string().trim().uuid().nullable().optional(),
  kind,
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  executionId: vine.string().trim().uuid().nullable().optional(),
  checkpointRunCount: vine.number().withoutDecimals().positive().nullable().optional(),
  status: status.optional(),
})

export const updateUserStoryAgentRunValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  checkpointRunCount: vine.number().withoutDecimals().positive().nullable().optional(),
  diffEndRef,
  status: status.optional(),
  activities: vine.array(agentActivity).nullable().optional(),
  agentActivity: agentActivity.nullable().optional(),
  agentActivityUpdates: vine.array(agentActivity).maxLength(16).optional(),
  finalResponse: vine.string().nullable().optional(),
  usage: agentUsage.nullable().optional(),
  sessionSummary: vine.string().nullable().optional(),
  completedAt: nullableDateTime,
})

export const finalizeUserStoryAgentRunValidator = vine.create({
  activities: vine.array(agentActivity),
  agentLastError: vine.string().trim().maxLength(4096).nullable().optional(),
  agentLastEvent: vine.string().trim().maxLength(4096).nullable().optional(),
  completedAt: nullableDateTime,
  diffEndRef,
  finalResponse: vine.string().nullable().optional(),
  outcome: finalizationOutcome,
  sessionSummary: vine.string().nullable().optional(),
  status: terminalStatus,
  usage: agentUsage.nullable().optional(),
})
