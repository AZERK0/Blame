import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import QuickChat from '#models/quick_chat'
import {
  consumeCodeSelectionAttachments,
  consumeFileAttachments,
  prepareCodeSelectionAttachments,
  prepareFileAttachments,
  type UserStoryCodeSelectionAttachment,
  type UserStoryFileAttachment,
} from '#models/user_story'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class QuickChatMessage extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(message: QuickChatMessage) {
    assignUuidV7Id(message)
  }

  @column()
  declare quickChatId: string

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

  @belongsTo(() => QuickChat)
  declare quickChat: BelongsTo<typeof QuickChat>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
