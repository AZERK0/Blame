import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import PreviewAccessTicket from '#models/preview_access_ticket'
import PreviewEndpointRoute from '#models/preview_endpoint_route'
import PreviewSession from '#models/preview_session'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { createHash, randomBytes } from 'node:crypto'
import { PreviewRuntimeError } from '@blame/preview-runtime'

export default class PreviewAccessTicketService {
  constructor(private readonly config: PreviewRuntimeConfig = previewRuntimeConfig()) {}

  async issue(sessionId: string, routeId: string, ownerUserId: string) {
    await PreviewSession.query()
      .where('id', sessionId)
      .where('ownerUserId', ownerUserId)
      .firstOrFail()
    const route = await PreviewEndpointRoute.query()
      .where('sessionId', sessionId)
      .where('id', routeId)
      .where('revoked', false)
      .firstOrFail()
    const ticket = randomBytes(32).toString('base64url')
    const expiresAt = DateTime.utc().plus({ seconds: this.config.ticketTtlSeconds })
    await PreviewAccessTicket.create({
      sessionId,
      ownerUserId,
      routeId: route.id,
      serviceId: route.serviceId,
      endpointId: route.endpointId,
      ticketHash: ticketHash(ticket),
      expiresAt,
      usedAt: null,
    })
    return {
      ticket,
      expiresAt: expiresAt.toISO()!,
      openUrl: `${new URL(this.config.edgeOrigin).protocol}//${route.publicHostname}/__blame/open`,
    }
  }

  async consume(ticket: string, ownerUserId: string, publicHostname: string) {
    return db.transaction(async (transaction) => {
      const route = await PreviewEndpointRoute.query({ client: transaction })
        .where('publicHostname', publicHostname.toLowerCase())
        .where('revoked', false)
        .firstOrFail()
      const record = await PreviewAccessTicket.query({ client: transaction })
        .where('ticketHash', ticketHash(ticket))
        .where('ownerUserId', ownerUserId)
        .where('sessionId', route.sessionId)
        .where('routeId', route.id)
        .forUpdate()
        .firstOrFail()
      if (record.usedAt || record.expiresAt <= DateTime.utc()) {
        throw new PreviewRuntimeError({
          code: 'PREVIEW_ACCESS_DENIED',
          message: 'The preview access ticket is expired or already used.',
          retryable: false,
        })
      }
      record.useTransaction(transaction)
      record.usedAt = DateTime.utc()
      await record.save()
      return {
        sessionId: record.sessionId,
        routeId: record.routeId,
        serviceId: record.serviceId,
        endpointId: record.endpointId,
      }
    })
  }

  async consumeForEdge(ticket: string, publicHostname: string) {
    return db.transaction(async (transaction) => {
      const route = await PreviewEndpointRoute.query({ client: transaction })
        .where('publicHostname', publicHostname.toLowerCase())
        .where('revoked', false)
        .firstOrFail()
      const record = await PreviewAccessTicket.query({ client: transaction })
        .where('ticketHash', ticketHash(ticket))
        .where('sessionId', route.sessionId)
        .where('routeId', route.id)
        .forUpdate()
        .firstOrFail()
      if (record.usedAt || record.expiresAt <= DateTime.utc()) {
        throw new PreviewRuntimeError({
          code: 'PREVIEW_ACCESS_DENIED',
          message: 'The preview access ticket is expired or already used.',
          retryable: false,
        })
      }
      record.useTransaction(transaction)
      record.usedAt = DateTime.utc()
      await record.save()
      return {
        sessionId: record.sessionId,
        routeId: record.routeId,
        serviceId: record.serviceId,
        endpointId: record.endpointId,
        ownerUserId: record.ownerUserId,
      }
    })
  }

  async revokeSession(sessionId: string) {
    await PreviewAccessTicket.query()
      .where('sessionId', sessionId)
      .whereNull('usedAt')
      .update({ expiresAt: DateTime.utc() })
  }

  async cleanupExpired(limit = 500) {
    const records = await PreviewAccessTicket.query()
      .where('expiresAt', '<=', DateTime.utc().toJSDate())
      .orderBy('expiresAt', 'asc')
      .limit(limit)
    await Promise.all(records.map((record) => record.delete()))
  }
}

function ticketHash(ticket: string) {
  return createHash('sha256').update(ticket).digest('hex')
}
