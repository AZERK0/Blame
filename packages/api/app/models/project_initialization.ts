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

type PreviewManifest = Record<string, unknown>

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

export function preparePreviewManifest(value: PreviewManifest | null) {
  return value ? JSON.stringify(value) : null
}

export function consumePreviewManifest(value: unknown) {
  if (!value) return null
  if (typeof value === 'object') return value as PreviewManifest
  if (typeof value !== 'string') return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as PreviewManifest) : null
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
    consume: consumePreviewManifest,
    prepare: preparePreviewManifest,
  })
  declare previewManifest: PreviewManifest | null

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
