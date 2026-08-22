import { assignUuidV7Id } from '#lib/uuid_v7_model'
import {
  consumeAgentActivity,
  prepareAgentActivity,
  type UserStoryAgentActivity,
} from '#models/user_story'
import UserStoryAgentRun from '#models/user_story_agent_run'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import { DateTime } from 'luxon'

export default class UserStoryAgentRunActivity extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(record: UserStoryAgentRunActivity) {
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

  @belongsTo(() => UserStoryAgentRun, { foreignKey: 'runId' })
  declare run: BelongsTo<typeof UserStoryAgentRun>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
