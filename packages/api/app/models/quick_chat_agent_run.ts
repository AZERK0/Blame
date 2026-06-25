import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import QuickChat from '#models/quick_chat'
import QuickChatMessage from '#models/quick_chat_message'
import {
  consumeAgentActivities,
  consumeAgentUsage,
  prepareAgentActivities,
  prepareAgentUsage,
  type UserStoryAgentActivity,
  type UserStoryAgentUsage,
} from '#models/user_story'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export type QuickChatAgentRunKind = 'initial' | 'change-request' | 'resume'
export type QuickChatAgentRunStatus = 'running' | 'completed' | 'failed'

export default class QuickChatAgentRun extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare quickChatId: number

  @column()
  declare messageId: number | null

  @column()
  declare kind: QuickChatAgentRunKind

  @column()
  declare clineSessionId: string | null

  @column()
  declare status: QuickChatAgentRunStatus

  @column({
    consume: consumeAgentActivities,
    prepare: prepareAgentActivities,
  })
  declare activities: UserStoryAgentActivity[] | null

  @column()
  declare finalResponse: string | null

  @column({
    consume: consumeAgentUsage,
    prepare: prepareAgentUsage,
  })
  declare usage: UserStoryAgentUsage | null

  @column()
  declare sessionSummary: string | null

  @column.dateTime()
  declare completedAt: DateTime | null

  @belongsTo(() => QuickChat)
  declare quickChat: BelongsTo<typeof QuickChat>

  @belongsTo(() => QuickChatMessage, { foreignKey: 'messageId' })
  declare message: BelongsTo<typeof QuickChatMessage>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
