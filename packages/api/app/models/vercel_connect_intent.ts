import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class VercelConnectIntent extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(intent: VercelConnectIntent) {
    assignUuidV7Id(intent)
  }

  @column()
  declare userId: string

  @column()
  declare stateHash: string

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime()
  declare consumedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
