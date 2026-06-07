import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import UserStory, {
  type UserStoryAgentActivity,
  type UserStoryAgentUsage,
} from '#models/user_story'
import UserStoryComment from '#models/user_story_comment'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type UserStoryAgentRunKind = 'initial' | 'change-request' | 'resume'
export type UserStoryAgentRunStatus = 'running' | 'completed' | 'failed'

function prepareActivities(value: UserStoryAgentActivity[] | null) {
  return value ? JSON.stringify(value) : null
}

function consumeActivities(value: unknown) {
  if (Array.isArray(value)) return value as UserStoryAgentActivity[]
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as UserStoryAgentActivity[]) : null
  } catch {
    return null
  }
}

function prepareUsage(value: UserStoryAgentUsage | null) {
  return value ? JSON.stringify(value) : null
}

function consumeUsage(value: unknown) {
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

export default class UserStoryAgentRun extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userStoryId: number

  @column()
  declare commentId: number | null

  @column()
  declare kind: UserStoryAgentRunKind

  @column()
  declare clineSessionId: string | null

  @column()
  declare status: UserStoryAgentRunStatus

  @column({
    consume: consumeActivities,
    prepare: prepareActivities,
  })
  declare activities: UserStoryAgentActivity[] | null

  @column()
  declare finalResponse: string | null

  @column({
    consume: consumeUsage,
    prepare: prepareUsage,
  })
  declare usage: UserStoryAgentUsage | null

  @column()
  declare sessionSummary: string | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @belongsTo(() => UserStory)
  declare userStory: BelongsTo<typeof UserStory>

  @belongsTo(() => UserStoryComment, { foreignKey: 'commentId' })
  declare comment: BelongsTo<typeof UserStoryComment>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
