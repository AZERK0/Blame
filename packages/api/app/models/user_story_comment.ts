import { BaseModel, belongsTo, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import UserStory from '#models/user_story'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'

export default class UserStoryComment extends BaseModel {
  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userStoryId: number

  @column()
  declare body: string

  @column()
  declare author: string

  @belongsTo(() => UserStory)
  declare userStory: BelongsTo<typeof UserStory>

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
