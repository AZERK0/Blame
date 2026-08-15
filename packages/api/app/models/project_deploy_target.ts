import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import { parseDeploymentManifest, type DeploymentManifest } from '@blame/deploy-contract'

export default class ProjectDeployTarget extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(target: ProjectDeployTarget) {
    assignUuidV7Id(target)
  }

  @column()
  declare projectId: string

  @column()
  declare vercelConnectionId: string

  @column()
  declare vercelProjectId: string | null

  @column()
  declare vercelProjectName: string

  @column()
  declare rootDirectory: string

  @column()
  declare framework: string | null

  @column()
  declare productionUrl: string | null

  @column({
    prepare: (value: DeploymentManifest) => JSON.stringify(value),
    consume: (value: unknown) =>
      parseDeploymentManifest(typeof value === 'string' ? JSON.parse(value) : value),
  })
  declare deploymentManifest: DeploymentManifest

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
