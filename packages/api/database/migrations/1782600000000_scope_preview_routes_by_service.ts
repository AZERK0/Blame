import { BaseSchema } from '@adonisjs/lucid/schema'

/**
 * Endpoint ids are local to a service. Derived tickets/routes can be dropped
 * safely and will be regenerated from the current session generation.
 */
export default class extends BaseSchema {
  async up() {
    await this.db.from('preview_access_tickets').delete()
    await this.db.from('preview_endpoint_routes').delete()

    // MySQL may use the old composite unique index to enforce the
    // preview_endpoint_routes.session_id foreign key. Give that foreign key
    // an explicit supporting index before replacing the unique constraint.
    this.schema.alterTable('preview_endpoint_routes', (table) => {
      table.index(['session_id'])
    })
    this.schema.alterTable('preview_endpoint_routes', (table) => {
      table.dropUnique(['session_id', 'endpoint_id'])
      table.unique(['session_id', 'service_id', 'endpoint_id'])
    })
    this.schema.alterTable('preview_access_tickets', (table) => {
      table.string('route_id', 64).notNullable().index()
      table.string('service_id', 128).notNullable()
      table.index(['session_id', 'service_id', 'endpoint_id'])
    })
  }

  async down() {
    // Dropped derived routes/tickets cannot and need not be reconstructed.
    this.schema.alterTable('preview_access_tickets', (table) => {
      table.dropIndex(['session_id', 'service_id', 'endpoint_id'])
      table.dropColumn('service_id')
      table.dropColumn('route_id')
    })
    this.schema.alterTable('preview_endpoint_routes', (table) => {
      table.dropUnique(['session_id', 'service_id', 'endpoint_id'])
      table.unique(['session_id', 'endpoint_id'])
    })
    this.schema.alterTable('preview_endpoint_routes', (table) => {
      table.dropIndex(['session_id'])
    })
  }
}
