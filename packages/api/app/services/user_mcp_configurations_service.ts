import UserMcpConfiguration from '#models/user_mcp_configuration'
import type { saveUserMcpConfigurationValidator } from '#validators/user_mcp_configuration'
import type { Infer } from '@vinejs/vine/types'

type SaveInput = Infer<typeof saveUserMcpConfigurationValidator>

export default class UserMcpConfigurationsService {
  get(userId: string) {
    return UserMcpConfiguration.find(userId)
  }

  async save(userId: string, input: SaveInput) {
    validateServers(input.servers)
    const existing = await UserMcpConfiguration.find(userId)
    if (!existing) return UserMcpConfiguration.create({ userId, servers: input.servers })
    existing.servers = input.servers
    await existing.save()
    return existing
  }
}

function validateServers(servers: SaveInput['servers']) {
  const names = new Set<string>()
  for (const server of servers) {
    const normalizedName = server.name.toLocaleLowerCase()
    if (names.has(normalizedName)) throw new Error('MCP server names must be unique')
    names.add(normalizedName)
    if (server.transport === 'stdio') {
      if (!server.command || server.url) throw new Error('Invalid stdio MCP server configuration')
      if (/\s/.test(server.command)) throw new Error('MCP commands must not contain arguments')
      continue
    }
    if (!server.url || server.command) throw new Error('Invalid remote MCP server configuration')
    const url = new URL(server.url)
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(
        'MCP server URLs stored in the cloud cannot contain credentials or parameters'
      )
    }
  }
}
