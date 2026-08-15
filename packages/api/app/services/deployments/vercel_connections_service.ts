import { vercelIntegrationConfig } from '#config/vercel_integration'
import VercelConnectIntent from '#models/vercel_connect_intent'
import VercelConnection from '#models/vercel_connection'
import {
  VercelApiClient,
  exchangeVercelInstallationCode,
  type VercelProjectSummary,
} from './vercel_api_client.js'
import { Exception } from '@adonisjs/core/exceptions'
import encryption from '@adonisjs/core/services/encryption'
import db from '@adonisjs/lucid/services/db'
import { createHash, randomBytes } from 'node:crypto'
import { DateTime } from 'luxon'

const intentTtlMinutes = 10

export default class VercelConnectionsService {
  async createIntent(userId: string) {
    const config = requiredConfig()
    const state = randomBytes(32).toString('base64url')
    await VercelConnectIntent.create({
      userId,
      stateHash: stateHash(state),
      expiresAt: DateTime.utc().plus({ minutes: intentTtlMinutes }),
      consumedAt: null,
    })
    const url = new URL(
      `/integrations/${encodeURIComponent(config.slug)}/new`,
      'https://vercel.com'
    )
    url.searchParams.set('state', state)
    return { url: url.toString(), expiresAt: DateTime.utc().plus({ minutes: intentTtlMinutes }) }
  }

  list(userId: string) {
    return VercelConnection.query().where('userId', userId).orderBy('createdAt', 'asc')
  }

  async callback(input: { state: string; code: string; configurationId: string; teamId?: string }) {
    const config = requiredConfig()
    const userId = await consumeIntent(input.state)
    const exchanged = await exchangeVercelInstallationCode({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: input.code,
      redirectUri: config.redirectUri,
    })
    if (exchanged.teamId && input.teamId && exchanged.teamId !== input.teamId) {
      throw new Exception('Vercel installation scope is inconsistent', {
        status: 400,
        code: 'E_VERCEL_SCOPE_INVALID',
      })
    }
    const teamId = exchanged.teamId ?? input.teamId ?? null
    const scopeType = teamId ? ('team' as const) : ('personal' as const)
    const scopeKey = teamId ? `team:${teamId}` : 'personal'
    const client = new VercelApiClient(exchanged.accessToken, teamId)
    const scopeDisplayName = await client.scopeIdentity()
    const encryptedAccessToken = await encryption.encrypt(exchanged.accessToken)
    return db.transaction(async (transaction) => {
      const byConfiguration = await VercelConnection.query({ client: transaction })
        .where('configurationId', input.configurationId)
        .forUpdate()
        .first()
      if (byConfiguration && byConfiguration.userId !== userId) {
        throw new Exception('Vercel installation already belongs to another account', {
          status: 409,
          code: 'E_VERCEL_CONNECTION_CONFLICT',
        })
      }
      const connection =
        byConfiguration ??
        (await VercelConnection.query({ client: transaction })
          .where('userId', userId)
          .where('scopeKey', scopeKey)
          .forUpdate()
          .first()) ??
        new VercelConnection()
      connection.useTransaction(transaction)
      connection.merge({
        userId,
        configurationId: input.configurationId,
        scopeType,
        teamId,
        scopeKey,
        scopeDisplayName,
        encryptedAccessToken,
        status: 'active',
        lastValidatedAt: DateTime.utc(),
        removedAt: null,
      })
      await connection.save()
      return connection
    })
  }

  async projects(userId: string, connectionId: string, cursor?: string) {
    const connection = await this.active(userId, connectionId)
    return this.client(connection).then((client) => client.projects(cursor))
  }

  async project(userId: string, connectionId: string, projectId: string) {
    const connection = await this.active(userId, connectionId)
    return this.client(connection).then((client) => client.project(projectId))
  }

  async findProjectByName(userId: string, connectionId: string, name: string) {
    const connection = await this.active(userId, connectionId)
    return this.client(connection).then((client) => client.projectByName(name))
  }

  async unlink(userId: string, connectionId: string) {
    const connection = await VercelConnection.query()
      .where('id', connectionId)
      .where('userId', userId)
      .firstOrFail()
    connection.merge({
      encryptedAccessToken: await encryption.encrypt(randomBytes(32).toString('base64url')),
      status: 'removed',
      removedAt: DateTime.utc(),
    })
    await connection.save()
  }

  async active(userId: string, connectionId: string) {
    const connection = await VercelConnection.query()
      .where('id', connectionId)
      .where('userId', userId)
      .where('status', 'active')
      .first()
    if (!connection) {
      throw new Exception('Reconnect Vercel to continue', {
        status: 409,
        code: 'E_VERCEL_CONNECTION_INACTIVE',
      })
    }
    return connection
  }

  async client(connection: VercelConnection) {
    const token = await encryption.decrypt(connection.encryptedAccessToken)
    if (typeof token !== 'string' || !token) {
      throw new Exception('Vercel connection is invalid', {
        status: 409,
        code: 'E_VERCEL_CONNECTION_INVALID',
      })
    }
    return new VercelApiClient(token, connection.teamId)
  }
}

export function serializeVercelConnection(connection: VercelConnection) {
  return {
    id: connection.id,
    provider: 'vercel' as const,
    scopeType: connection.scopeType,
    scopeDisplayName: connection.scopeDisplayName,
    status: connection.status,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  }
}

export function serializeVercelProject(project: VercelProjectSummary) {
  return { id: project.id, name: project.name, framework: project.framework }
}

export function safeVercelNext(value: string | undefined) {
  if (!value) return 'https://vercel.com/dashboard'
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      (url.hostname !== 'vercel.com' && !url.hostname.endsWith('.vercel.com'))
    ) {
      return 'https://vercel.com/dashboard'
    }
    return url.toString()
  } catch {
    return 'https://vercel.com/dashboard'
  }
}

async function consumeIntent(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state)) invalidIntent()
  return db.transaction(async (transaction) => {
    const intent = await VercelConnectIntent.query({ client: transaction })
      .where('stateHash', stateHash(state))
      .forUpdate()
      .first()
    if (!intent || intent.consumedAt || intent.expiresAt <= DateTime.utc()) invalidIntent()
    intent.useTransaction(transaction)
    intent.consumedAt = DateTime.utc()
    await intent.save()
    return intent.userId
  })
}

function stateHash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function invalidIntent(): never {
  throw new Exception('Vercel connection request is invalid or expired', {
    status: 400,
    code: 'E_VERCEL_CONNECT_INTENT_INVALID',
  })
}

function requiredConfig() {
  const config = vercelIntegrationConfig()
  if (!config) {
    throw new Exception('Vercel integration is not configured', {
      status: 503,
      code: 'E_VERCEL_INTEGRATION_UNAVAILABLE',
    })
  }
  return config
}
