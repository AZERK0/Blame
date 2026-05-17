import vine from '@vinejs/vine'

const status = vine.enum(['backlog', 'ready', 'in-progress', 'in-review', 'done', 'discarded'])
const priority = vine.enum(['Low', 'Medium', 'High'])
const agentStatus = vine.enum(['Running', 'Paused'])

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
  mergedAt: vine.date().nullable().optional(),
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
  mergedAt: vine.date().nullable().optional(),
  mergeCommit: vine.string().trim().maxLength(255).nullable().optional(),
  discardedReason: vine.string().trim().maxLength(2048).nullable().optional(),
})
