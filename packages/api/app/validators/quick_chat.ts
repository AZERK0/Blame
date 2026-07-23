import vine from '@vinejs/vine'
import {
  agentActivity,
  agentStatus,
  agentUsage,
  codeSelectionAttachment,
  fileAttachment,
} from '#validators/user_story'

export const listQuickChatsValidator = vine.create({
  projectId: vine.string().trim().minLength(1),
  view: vine.enum(['summary', 'detail']).optional(),
})

export const createQuickChatValidator = vine.create({
  projectId: vine.string().trim().minLength(1),
  title: vine.string().trim().minLength(1).maxLength(255),
  workspace: vine.string().trim().maxLength(2048).nullable().optional(),
  agentStatus: agentStatus.nullable().optional(),
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  agentProviderId: vine.string().trim().maxLength(80).nullable().optional(),
  agentModelId: vine.string().trim().maxLength(255).nullable().optional(),
  agentLastEvent: vine.string().trim().maxLength(4096).nullable().optional(),
  agentLastError: vine.string().trim().maxLength(4096).nullable().optional(),
  agentActivities: vine.array(agentActivity).nullable().optional(),
  agentActivity: agentActivity.nullable().optional(),
  agentFinalResponse: vine.string().nullable().optional(),
  agentUsage: agentUsage.nullable().optional(),
  agentSessionSummary: vine.string().nullable().optional(),
})

export const updateQuickChatValidator = vine.create({
  title: vine.string().trim().minLength(1).maxLength(255).optional(),
  workspace: vine.string().trim().maxLength(2048).nullable().optional(),
  agentStatus: agentStatus.nullable().optional(),
  clineSessionId: vine.string().trim().maxLength(255).nullable().optional(),
  agentProviderId: vine.string().trim().maxLength(80).nullable().optional(),
  agentModelId: vine.string().trim().maxLength(255).nullable().optional(),
  agentLastEvent: vine.string().trim().maxLength(4096).nullable().optional(),
  agentLastError: vine.string().trim().maxLength(4096).nullable().optional(),
  agentActivities: vine.array(agentActivity).nullable().optional(),
  agentActivity: agentActivity.nullable().optional(),
  agentFinalResponse: vine.string().nullable().optional(),
  agentUsage: agentUsage.nullable().optional(),
  agentSessionSummary: vine.string().nullable().optional(),
})

export const createQuickChatMessageValidator = vine.create({
  body: vine.string().trim().minLength(1).maxLength(32768),
  codeSelectionAttachments: vine.array(codeSelectionAttachment).nullable().optional(),
  fileAttachments: vine.array(fileAttachment).nullable().optional(),
})

export const undoQuickChatMessageValidator = vine.create({
  clineSessionId: vine.string().trim().maxLength(255).optional(),
  runId: vine.string().trim().uuid(),
})
