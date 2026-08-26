import vine from '@vinejs/vine'
import { agentActivity, agentStatus, agentUsage, nullableDateTime } from '#validators/user_story'
import { agentPersistenceEvent } from '#validators/user_story_agent_run'

const kind = vine.enum(['initial', 'change-request', 'resume'])
const status = vine.enum(['pending', 'running', 'completed', 'failed', 'cancelled'])
const terminalStatus = vine.enum(['completed', 'failed', 'cancelled'])

export const createQuickChatAgentRunValidator = vine.create({
  messageId: vine.string().trim().uuid().nullable().optional(),
  kind,
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  executionId: vine.string().trim().uuid().nullable().optional(),
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
  agentActivityUpdates: vine.array(agentActivity).maxLength(16).optional(),
  finalResponse: vine.string().nullable().optional(),
  usage: agentUsage.nullable().optional(),
  sessionSummary: vine.string().nullable().optional(),
  completedAt: nullableDateTime,
  persistenceEvent: agentPersistenceEvent.optional(),
})

export const finalizeQuickChatAgentRunValidator = vine.create({
  activities: vine.array(agentActivity),
  agentLastError: vine.string().trim().maxLength(4096).nullable().optional(),
  agentLastEvent: vine.string().trim().maxLength(4096).nullable().optional(),
  agentStatus: agentStatus.nullable().optional(),
  completedAt: nullableDateTime,
  finalResponse: vine.string().nullable().optional(),
  persistenceEvent: agentPersistenceEvent,
  sessionSummary: vine.string().nullable().optional(),
  status: terminalStatus,
  usage: agentUsage.nullable().optional(),
})
