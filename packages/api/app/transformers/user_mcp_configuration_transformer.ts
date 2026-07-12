import type UserMcpConfiguration from '#models/user_mcp_configuration'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class UserMcpConfigurationTransformer extends BaseTransformer<UserMcpConfiguration> {
  toObject() {
    return {
      servers: this.resource.servers,
      createdAt: this.resource.createdAt.toISO(),
      updatedAt: this.resource.updatedAt?.toISO() ?? null,
    }
  }
}
