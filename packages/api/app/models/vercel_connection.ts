import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { DeployConnectionStatus } from '@blame/deploy-contract'

export default class VercelConnection extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(connection: VercelConnection) {
    assignUuidV7Id(connection)
  }

  @column()
  declare userId: string

  @column()
  declare configurationId: string

  @column()
  declare scopeType: 'personal' | 'team'

  @column()
  declare teamId: string | null

  @column()
  declare scopeKey: string

  @column()
  declare scopeDisplayName: string

  @column({ serializeAs: null })
  declare encryptedAccessToken: string

  @column()
  declare status: DeployConnectionStatus

  @column.dateTime()
  declare lastValidatedAt: DateTime | null

  @column.dateTime()
  declare removedAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
