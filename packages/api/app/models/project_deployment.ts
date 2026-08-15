import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'
import type { DeploymentStatus } from '@blame/deploy-contract'

export default class ProjectDeployment extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(deployment: ProjectDeployment) {
    assignUuidV7Id(deployment)
  }

  @column()
  declare projectId: string

  @column()
  declare targetId: string

  @column()
  declare vercelConnectionId: string

  @column()
  declare operationId: string

  @column()
  declare providerDeploymentId: string | null

  @column()
  declare sourceRevision: string

  @column()
  declare sourceBranch: string | null

  @column()
  declare workspaceHash: string

  @column()
  declare manifestHash: string

  @column()
  declare localChangeCount: number

  @column()
  declare fileCount: number

  @column()
  declare sourceBytes: number

  @column()
  declare status: DeploymentStatus

  @column()
  declare providerState: string | null

  @column()
  declare deploymentUrl: string | null

  @column()
  declare productionUrl: string | null

  @column()
  declare errorCode: string | null

  @column()
  declare safeErrorMessage: string | null

  @column()
  declare providerRequestId: string | null

  @column.dateTime()
  declare submittedAt: DateTime | null

  @column.dateTime()
  declare readyAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
