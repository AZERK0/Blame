import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PreviewUsageSample extends BaseModel {
  @column({ isPrimary: true })
  declare id: number
  @column()
  declare sessionId: string
  @column()
  declare generation: number
  @column()
  declare activeCpuSeconds: number
  @column()
  declare memoryGbSeconds: number
  @column()
  declare ingressBytes: number
  @column()
  declare egressBytes: number
  @column()
  declare snapshotBytes: number
  @column()
  declare estimatedCostUsd: number
  @column()
  declare cumulativeEstimatedCostUsd: number
  @column.dateTime()
  declare observedAt: DateTime
}
