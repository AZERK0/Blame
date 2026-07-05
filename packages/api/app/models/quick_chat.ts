import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column, hasMany } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import QuickChatAgentRun from '#models/quick_chat_agent_run'
import QuickChatMessage from '#models/quick_chat_message'
import {
  consumeAgentActivities,
  consumeAgentUsage,
  prepareAgentActivities,
  prepareAgentUsage,
  type UserStoryAgentActivity,
  type UserStoryAgentUsage,
} from '#models/user_story'
import type { HasMany } from '@adonisjs/lucid/types/relations'

export type QuickChatAgentStatus = 'Running' | 'Paused'

export default class QuickChat extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(chat: QuickChat) {
    assignUuidV7Id(chat)
  }

  @column()
  declare projectId: string

  @column()
  declare title: string

  @column()
  declare workspace: string | null

  @column()
  declare agentStatus: QuickChatAgentStatus | null

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

  @hasMany(() => QuickChatMessage)
  declare messages: HasMany<typeof QuickChatMessage>

  @hasMany(() => QuickChatAgentRun)
  declare agentRuns: HasMany<typeof QuickChatAgentRun>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
