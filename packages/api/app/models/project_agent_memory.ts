import { assignUuidV7Id } from '#lib/uuid_v7_model'
import { BaseModel, beforeCreate, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export type ProjectAgentMemoryFile = { hash: string; path: string }

export default class ProjectAgentMemory extends BaseModel {
  static selfAssignPrimaryKey = true

  @column({ isPrimary: true })
  declare id: string

  @beforeCreate()
  static assignId(memory: ProjectAgentMemory) {
    assignUuidV7Id(memory)
  }

  @column()
  declare projectId: string

  @column()
  declare fingerprint: string

  @column()
  declare objective: string

  @column()
  declare summary: string

  @column({ consume: consumeFiles, prepare: prepareJson })
  declare files: ProjectAgentMemoryFile[]

  @column({ consume: consumeSymbols, prepare: prepareJson })
  declare symbols: string[]

  @column()
  declare sourceRevisionId: string

  @column()
  declare storyId: string | null

  @column()
  declare validationKind: string | null

  @column()
  declare validationTaskId: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}

function prepareJson(value: unknown[]) {
  return JSON.stringify(value)
}

function consumeFiles(value: unknown) {
  return consumeArray(value) as ProjectAgentMemoryFile[]
}

function consumeSymbols(value: unknown) {
  return consumeArray(value).filter((item): item is string => typeof item === 'string')
}

function consumeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  const parsed: unknown = JSON.parse(value)
  return Array.isArray(parsed) ? parsed : []
}
