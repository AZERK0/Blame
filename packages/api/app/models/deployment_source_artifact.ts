import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class DeploymentSourceArtifact extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(artifact: DeploymentSourceArtifact) {
    assignUuidV7Id(artifact)
  }

  @column()
  declare deploymentId: string

  @column()
  declare status: 'uploading' | 'durable' | 'transferring' | 'deleted' | 'invalid'

  @column()
  declare objectKey: string

  @column()
  declare sha256: string

  @column()
  declare size: number

  @column.dateTime()
  declare durableAt: DateTime | null

  @column.dateTime()
  declare deletedAt: DateTime | null

  @column.dateTime()
  declare expiresAt: DateTime

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
