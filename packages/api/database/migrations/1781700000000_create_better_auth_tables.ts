import { BaseSchema } from '@adonisjs/lucid/schema'
import { uuidV7 } from '#lib/uuid_v7'

export default class extends BaseSchema {
  async up() {
    this.schema.alterTable('users', (table) => {
      table.boolean('email_verified').notNullable().defaultTo(false)
      table.string('image', 2048).nullable()
      table.string('password').nullable().alter()
    })

    this.schema.createTable('auth_sessions', (table) => {
      table.uuid('id').primary()
      table.string('token', 255).notNullable().unique()
      table.timestamp('expires_at').notNullable()
      table.string('ip_address', 64).nullable()
      table.string('user_agent', 1024).nullable()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['user_id'])
    })

    this.schema.createTable('auth_accounts', (table) => {
      table.uuid('id').primary()
      table.string('account_id', 255).notNullable()
      table.string('provider_id', 64).notNullable()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.text('access_token').nullable()
      table.text('refresh_token').nullable()
      table.text('id_token').nullable()
      table.timestamp('access_token_expires_at').nullable()
      table.timestamp('refresh_token_expires_at').nullable()
      table.text('scope').nullable()
      table.text('password').nullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.unique(['provider_id', 'account_id'])
      table.index(['user_id'])
    })

    this.schema.createTable('auth_verifications', (table) => {
      table.uuid('id').primary()
      table.string('identifier', 255).notNullable()
      table.text('value').notNullable()
      table.timestamp('expires_at').notNullable()
      table.timestamp('created_at').notNullable()
      table.timestamp('updated_at').notNullable()
      table.index(['identifier'])
    })

    this.schema.createTable('passkey', (table) => {
      table.uuid('id').primary()
      table.string('name', 255).nullable()
      table.text('publicKey').notNullable()
      table.uuid('userId').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.string('credentialID', 512).notNullable().unique()
      table.bigInteger('counter').unsigned().notNullable()
      table.string('deviceType', 64).notNullable()
      table.boolean('backedUp').notNullable()
      table.text('transports').nullable()
      table.timestamp('createdAt').nullable()
      table.string('aaguid', 64).nullable()
      table.index(['userId'])
    })

    this.schema.createTable('auth_desktop_handoffs', (table) => {
      table.uuid('id').primary()
      table.string('code_hash', 64).notNullable().unique()
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE')
      table.timestamp('expires_at').notNullable()
      table.timestamp('consumed_at').nullable()
      table.timestamp('created_at').notNullable()
      table.index(['expires_at'])
    })

    this.defer(async (db) => {
      const users = await db.from('users').select(['id', 'email', 'password', 'created_at'])
      if (users.length === 0) return
      await db.table('auth_accounts').multiInsert(
        users.map((user) => ({
          id: uuidV7(),
          account_id: user.id,
          provider_id: 'credential',
          user_id: user.id,
          password: user.password,
          created_at: user.created_at,
          updated_at: user.created_at,
        }))
      )
      for (const user of users) {
        await db
          .from('users')
          .where('id', user.id)
          .update({
            email_verified: true,
            full_name: db.raw('COALESCE(full_name, SUBSTRING_INDEX(email, ?, 1))', ['@']),
          })
      }
    })
  }

  async down() {
    throw new Error(
      'Better Auth migration cannot be rolled back safely after password resets or social sign-ups'
    )
  }
}
