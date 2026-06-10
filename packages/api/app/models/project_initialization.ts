import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type ProjectInitializationStatus = 'pending' | 'running' | 'done' | 'error'

type ProjectRunConfiguration = {
  id: string
  name: string
  command: string
  cwd: string
  default: boolean
}

export function prepareRunConfigurations(value: ProjectRunConfiguration[] | null) {
  return value ? JSON.stringify(value) : null
}

export function consumeRunConfigurations(value: unknown) {
  if (Array.isArray(value)) return value as ProjectRunConfiguration[]
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as ProjectRunConfiguration[]) : null
  } catch {
    return null
  }
}

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

  @column({
    consume: consumeRunConfigurations,
    prepare: prepareRunConfigurations,
  })
  declare runConfigurations: ProjectRunConfiguration[] | null

  @column()
  declare error: string | null

  @column()
  declare repairReason: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime | null
}
