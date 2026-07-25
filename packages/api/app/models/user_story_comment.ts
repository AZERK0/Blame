import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { orderedFileAttachments } from '#lib/file_attachment'
import FileAttachment from '#models/file_attachment'
import {
  BaseModel,
  beforeCreate,
  belongsTo,
  column,
  computed,
  manyToMany,
} from '@adonisjs/lucid/orm'
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
import type { BelongsTo, ManyToMany } from '@adonisjs/lucid/types/relations'

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
    columnName: 'file_attachments',
    consume: consumeFileAttachments,
    prepare: prepareFileAttachments,
    serializeAs: null,
  })
  declare legacyFileAttachments: UserStoryFileAttachment[] | null

  @manyToMany(() => FileAttachment, {
    pivotColumns: ['position'],
    pivotForeignKey: 'user_story_comment_id',
    pivotRelatedForeignKey: 'file_attachment_id',
    pivotTable: 'user_story_comment_file_attachments',
    serializeAs: null,
  })
  declare storedFileAttachments: ManyToMany<typeof FileAttachment>

  @computed()
  get fileAttachments(): UserStoryFileAttachment[] | null {
    const stored = this.$preloaded.storedFileAttachments as FileAttachment[] | undefined
    return stored?.length ? orderedFileAttachments(stored) : this.legacyFileAttachments
  }

  @column()
  declare author: string

  @belongsTo(() => UserStory)
  declare userStory: BelongsTo<typeof UserStory>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
