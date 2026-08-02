import { BaseModel, column } from '@adonisjs/lucid/orm'
import { DateTime } from 'luxon'

export default class PreviewEvent extends BaseModel {
  @column({ isPrimary: true })
  declare id: number
  @column()
  declare sessionId: string
  @column()
  declare generation: number
  @column()
  declare sequence: number
  @column()
  declare type: string
  @column()
  declare state: string
  @column()
  declare serviceId: string | null
  @column()
  declare stream: string | null
  @column()
  declare message: string
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
