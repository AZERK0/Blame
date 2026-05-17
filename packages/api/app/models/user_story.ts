import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type UserStoryStatus =
  | 'backlog'
  | 'ready'
  | 'in-progress'
  | 'in-review'
  | 'done'
  | 'discarded'

export type UserStoryPriority = 'Low' | 'Medium' | 'High'
export type UserStoryAgentStatus = 'Running' | 'Paused'

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

  @column.dateTime()
  declare mergedAt: DateTime | null

  @column()
  declare mergeCommit: string | null

  @column()
  declare discardedReason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
