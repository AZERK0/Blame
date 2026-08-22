import { assignUuidV7Id } from '#lib/uuid_v7_model'
import QuickChatAgentRun from '#models/quick_chat_agent_run'
import {
  consumeAgentActivity,
  prepareAgentActivity,
  type UserStoryAgentActivity,
} from '#models/user_story'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

export default class QuickChatAgentRunActivity extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(record: QuickChatAgentRunActivity) {
    assignUuidV7Id(record)
  }

  @column()
  declare runId: string

  @column()
  declare activityId: string

  @column({
    consume: consumeAgentActivity,
    prepare: prepareAgentActivity,
  })
  declare activity: UserStoryAgentActivity | null

  @belongsTo(() => QuickChatAgentRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof QuickChatAgentRun>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
