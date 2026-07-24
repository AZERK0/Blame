import { uuidV7 } from '#lib/uuid_v7'
import { BaseSchema } from '@adonisjs/lucid/schema'
import { randomBytes } from 'node:crypto'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.boolean('two_factor_enabled').notNullable().defaultTo(true)
    })

    this.schema.createTable('auth_two_factors', (table) => {
      table.uuid('id').primary()
      table.string('secret', 255).notNullable()
      table.text('backup_codes').notNullable()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.boolean('verified').notNullable().defaultTo(true)
      table.integer('failed_verification_count').unsigned().notNullable().defaultTo(0)
      table.timestamp('locked_until').nullable()
      table.unique(['user_id'])
    })

    this.defer(async (db) => {
      const users = await db.from('users').select('id')
      if (users.length === 0) return
      await db
        .table('auth_two_factors')
        .multiInsert(users.map((user) => emailTwoFactorRecord(user.id)))
    })
  }

  async down() {
    this.schema.dropTable('auth_two_factors')
    this.schema.alterTable('users', (table) => {
      table.dropColumn('two_factor_enabled')
    })
  }
}

function emailTwoFactorRecord(userId: string) {
  return {
    id: uuidV7(),
    secret: randomBytes(32).toString('base64url'),
    backup_codes: '[]',
    user_id: userId,
    verified: true,
    failed_verification_count: 0,
  }
}
