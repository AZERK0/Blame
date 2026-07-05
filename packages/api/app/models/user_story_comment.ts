import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import UserStory from '#models/user_story'
import {
  consumeCodeSelectionAttachments,
  consumeFileAttachments,
  prepareCodeSelectionAttachments,
  prepareFileAttachments,
  type UserStoryCodeSelectionAttachment,
  type UserStoryFileAttachment,
} from '#models/user_story'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class UserStoryComment extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(comment: UserStoryComment) {
    assignUuidV7Id(comment)
  }

  @column()
  declare userStoryId: string

  @column()
  declare body: string

  @column({
    consume: consumeCodeSelectionAttachments,
    prepare: prepareCodeSelectionAttachments,
  })
  declare codeSelectionAttachments: UserStoryCodeSelectionAttachment[] | null

  @column({
    consume: consumeFileAttachments,
    prepare: prepareFileAttachments,
  })
  declare fileAttachments: UserStoryFileAttachment[] | null

  @column()
  declare author: string

  @belongsTo(() => UserStory)
  declare userStory: BelongsTo<typeof UserStory>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
