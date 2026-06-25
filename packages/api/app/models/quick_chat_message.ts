import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
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
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare quickChatId: number

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
