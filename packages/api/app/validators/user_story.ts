import vine from '@vinejs/vine'
import { DateTime } from 'luxon'

const status = vine.enum(['backlog', 'ready', 'in-progress', 'in-review', 'done', 'discarded'])
const priority = vine.enum(['Low', 'Medium', 'High'])
export const agentStatus = vine.enum(['Running', 'Paused'])
export const agentActivityKind = vine.enum(['reasoning', 'message', 'tool', 'approval', 'notice'])
export const agentActivityMessageKind = vine.enum(['intermediate', 'final'])
export const agentActivityStatus = vine.enum(['running', 'completed', 'failed'])
export const agentActivity = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  kind: agentActivityKind,
  title: vine.string().trim().minLength(1).maxLength(255),
  detail: vine.string().maxLength(262144),
  status: agentActivityStatus.optional(),
  iteration: vine.number().optional(),
  messageKind: agentActivityMessageKind.optional(),
  agentName: vine.string().trim().maxLength(255).optional(),
  agentAvatar: vine.string().trim().maxLength(2048).optional(),
  toolCallId: vine.string().trim().maxLength(255).optional(),
  detailArtifact: vine.string().trim().maxLength(2048).optional(),
  detailTruncated: vine.boolean().optional(),
  originalDetailLength: vine.number().optional(),
  createdAt: vine.string().trim().minLength(1).maxLength(255),
  updatedAt: vine.string().trim().maxLength(255).optional(),
})
export const codeSelectionAttachment = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  content: vine.string().maxLength(262144),
  endLine: vine.number(),
  path: vine.string().trim().minLength(1).maxLength(2048),
  startLine: vine.number(),
})
export const fileAttachment = vine.object({
  id: vine.string().trim().minLength(1).maxLength(255),
  aiContextMarkdown: vine.string().maxLength(262144).optional(),
  content: vine.string().maxLength(10485760),
  name: vine.string().trim().minLength(1).maxLength(255),
  size: vine.number(),
  type: vine.string().trim().maxLength(255),
})
export const agentUsage = vine.object({
  cacheReadTokens: vine.number().optional(),
  cacheWriteTokens: vine.number().optional(),
  cost: vine.number().optional(),
  headroomCompressionCount: vine.number().optional(),
  headroomCompressionRatio: vine.number().optional(),
  headroomLastTokensSaved: vine.number().optional(),
  headroomTokensAfter: vine.number().optional(),
  headroomTokensBefore: vine.number().optional(),
  headroomTokensSaved: vine.number().optional(),
  inputTokens: vine.number(),
  outputTokens: vine.number(),
  totalCacheReadTokens: vine.number().optional(),
  totalCacheWriteTokens: vine.number().optional(),
  totalCost: vine.number().optional(),
  totalInputTokens: vine.number(),
  totalOutputTokens: vine.number(),
})
export const nullableDateTime = vine
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
  view: vine.enum(['summary', 'detail']).optional(),
})

export const createUserStoryValidator = vine.create({
  projectId: vine.string().trim().minLength(1),
  title: vine.string().trim().minLength(1).maxLength(255),
  summary: vine.string(),
  codeSelectionAttachments: vine.array(codeSelectionAttachment).nullable().optional(),
  fileAttachments: vine.array(fileAttachment).nullable().optional(),
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
  agentActivity: agentActivity.nullable().optional(),
  agentFinalResponse: vine.string().nullable().optional(),
  agentUsage: agentUsage.nullable().optional(),
  agentSessionSummary: vine.string().nullable().optional(),
  mergedAt: nullableDateTime,
  mergeCommit: vine.string().trim().maxLength(255).nullable().optional(),
  baseCommit: vine.string().trim().maxLength(255).nullable().optional(),
  discardedReason: vine.string().trim().maxLength(2048).nullable().optional(),
})

export const updateUserStoryValidator = vine.create({
  projectId: vine.string().trim().minLength(1).optional(),
  title: vine.string().trim().minLength(1).maxLength(255).optional(),
  summary: vine.string().optional(),
  codeSelectionAttachments: vine.array(codeSelectionAttachment).nullable().optional(),
  fileAttachments: vine.array(fileAttachment).nullable().optional(),
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
  agentActivity: agentActivity.nullable().optional(),
  agentFinalResponse: vine.string().nullable().optional(),
  agentUsage: agentUsage.nullable().optional(),
  agentSessionSummary: vine.string().nullable().optional(),
  mergedAt: nullableDateTime,
  mergeCommit: vine.string().trim().maxLength(255).nullable().optional(),
  baseCommit: vine.string().trim().maxLength(255).nullable().optional(),
  discardedReason: vine.string().trim().maxLength(2048).nullable().optional(),
})
