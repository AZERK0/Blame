import { BaseModel, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import UserStoryComment from '#models/user_story_comment'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export type UserStoryStatus =
  | 'backlog'
  | 'ready'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'discarded'

export type UserStoryPriority = 'Low' | 'Medium' | 'High'
export type UserStoryAgentStatus = 'Running' | 'Paused'
export type UserStoryAgentActivity = {
  id: string
  kind: 'reasoning' | 'tool' | 'approval' | 'notice'
  title: string
  detail: string
  status?: 'running' | 'completed' | 'failed'
  iteration?: number
  toolCallId?: string
  detailArtifact?: string
  detailTruncated?: boolean
  originalDetailLength?: number
  createdAt: string
  updatedAt?: string
}

export type UserStoryAgentToolUsage = {
  count: number
  maxBytes: number
  name: string
  totalBytes: number
  truncatedCount: number
}

export type UserStoryAgentUsage = {
  cacheReadTokens: number
  cacheWriteTokens: number
  compactionCount: number
  inputTokens: number
  largeFileReads: number
  maxContextTokens: number
  outputTokens: number
  unboundedFileReads: number
  tokensSavedEstimate: number
  topTools: UserStoryAgentToolUsage[]
  totalCost: number
  truncatedOutputs: number
}

function prepareAgentActivities(value: UserStoryAgentActivity[] | null) {
  return value ? JSON.stringify(value) : null
}

function consumeAgentActivities(value: unknown) {
  if (Array.isArray(value)) return value as UserStoryAgentActivity[]
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as UserStoryAgentActivity[]) : null
  } catch {
    return null
  }
}

function prepareAgentUsage(value: UserStoryAgentUsage | null) {
  return value ? JSON.stringify(value) : null
}

function consumeAgentUsage(value: unknown) {
  if (!value) return null
  if (typeof value === 'object') return value as UserStoryAgentUsage
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as UserStoryAgentUsage) : null
  } catch {
    return null
  }
}

export default class UserStory extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare projectId: string

  @column()
  declare title: string

  @column()
  declare summary: string

  @column()
  declare status: UserStoryStatus

  @column()
  declare priority: UserStoryPriority

  @column()
  declare owner: string

  @column()
  declare branch: string | null

  @column()
  declare previewUrl: string | null

  @column()
  declare worktree: string | null

  @column()
  declare agentStatus: UserStoryAgentStatus | null

  @column()
  declare clineSessionId: string | null

  @column()
  declare agentProviderId: string | null

  @column()
  declare agentModelId: string | null

  @column()
  declare agentLastEvent: string | null

  @column()
  declare agentLastError: string | null

  @column({
    consume: consumeAgentActivities,
    prepare: prepareAgentActivities,
  })
  declare agentActivities: UserStoryAgentActivity[] | null

  @column()
  declare agentFinalResponse: string | null

  @column({
    consume: consumeAgentUsage,
    prepare: prepareAgentUsage,
  })
  declare agentUsage: UserStoryAgentUsage | null

  @column()
  declare agentSessionSummary: string | null

  @column.dateTime()
  declare mergedAt: DateTime | null

  @column()
  declare mergeCommit: string | null

  @column()
  declare discardedReason: string | null

  @hasMany(() => UserStoryComment)
  declare comments: HasMany<typeof UserStoryComment>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
