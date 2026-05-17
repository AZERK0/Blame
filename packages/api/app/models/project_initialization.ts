import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type ProjectInitializationStatus = 'pending' | 'running' | 'done' | 'error'

export default class ProjectInitialization extends BaseModel {
  @column({ isPrimary: true })
  declare projectId: string

  @column()
  declare status: ProjectInitializationStatus

  @column()
  declare step: string

  @column()
  declare clineSessionId: string | null

  @column()
  declare agentProviderId: string | null

  @column()
  declare agentModelId: string | null

  @column()
  declare setupScript: string | null

  @column()
  declare dockerCompose: string | null

  @column()
  declare error: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
