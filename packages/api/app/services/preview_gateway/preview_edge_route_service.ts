import { appKey } from '#config/app'
import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import PreviewEndpointRoute from '#models/preview_endpoint_route'
import encryption from '@adonisjs/core/services/encryption'
import { createHmac } from 'node:crypto'
import PreviewSession from '#models/preview_session'
import { DateTime } from 'luxon'

export type PublishPreviewRouteInput = {
  sessionId: string
  endpointId: string
  serviceId: string
  logicalPort: number
  generation: number
  upstreamUrl: string
}

export default class PreviewEdgeRouteService {
  constructor(private readonly config: PreviewRuntimeConfig = previewRuntimeConfig()) {}

  identity(sessionId: string, serviceId: string, endpointId: string) {
    const id = opaqueRouteId(sessionId, serviceId, endpointId)
    const publicHostname = `${id}.${new URL(this.config.edgeOrigin).hostname}`
    return {
      id,
      publicHostname,
      publicUrl: `${new URL(this.config.edgeOrigin).protocol}//${publicHostname}`,
    }
  }

  async publish(input: PublishPreviewRouteInput) {
    assertProviderUpstream(input.upstreamUrl)
    const { id, publicHostname, publicUrl } = this.identity(
      input.sessionId,
      input.serviceId,
      input.endpointId
    )
    const upstreamUrlEncrypted = await encryption.encrypt(input.upstreamUrl)
    const route = await PreviewEndpointRoute.find(id)
    if (route) {
      route.merge({
        upstreamUrlEncrypted,
        generation: input.generation,
        logicalPort: input.logicalPort,
        revoked: false,
      })
      await route.save()
    } else {
      await PreviewEndpointRoute.create({
        id,
        sessionId: input.sessionId,
        endpointId: input.endpointId,
        serviceId: input.serviceId,
        logicalPort: input.logicalPort,
        publicHostname,
        upstreamUrlEncrypted,
        generation: input.generation,
        revoked: false,
      })
    }
    return {
      id,
      publicUrl,
    }
  }

  async resolve(publicHostname: string) {
    const route = await PreviewEndpointRoute.query()
      .where('publicHostname', canonicalHostname(publicHostname))
      .where('revoked', false)
      .firstOrFail()
    const session = await PreviewSession.findOrFail(route.sessionId)
    this.assertEnabled(session.ownerUserId)
    const state = JSON.parse(session.state) as { host?: string; preview?: string }
    if (state.host !== 'running' || state.preview !== 'ready') {
      throw new Error('Preview route is not active.')
    }
    await this.touchSession(session)
    const upstreamUrl = await encryption.decrypt(route.upstreamUrlEncrypted)
    if (typeof upstreamUrl !== 'string') throw new Error('Preview route is unreadable.')
    assertProviderUpstream(upstreamUrl)
    return {
      routeId: route.id,
      sessionId: route.sessionId,
      endpointId: route.endpointId,
      serviceId: route.serviceId,
      logicalPort: route.logicalPort,
      generation: route.generation,
      ownerUserId: session.ownerUserId,
      upstreamUrl,
    }
  }

  async revokeSession(sessionId: string) {
    await PreviewEndpointRoute.query().where('sessionId', sessionId).update({ revoked: true })
  }

  async resolveForDesktop(sessionId: string, ownerUserId: string) {
    const session = await PreviewSession.query()
      .where('id', sessionId)
      .where('ownerUserId', ownerUserId)
      .firstOrFail()
    this.assertEnabled(ownerUserId)
    const state = JSON.parse(session.state) as { host?: string; preview?: string }
    if (state.host !== 'running' || state.preview !== 'ready') {
      throw new Error('Preview route is not active.')
    }
    const records = await PreviewEndpointRoute.query()
      .where('sessionId', sessionId)
      .where('revoked', false)
    return Promise.all(
      records.map(async (route) => {
        const upstreamUrl = await encryption.decrypt(route.upstreamUrlEncrypted)
        if (typeof upstreamUrl !== 'string') throw new Error('Preview route is unreadable.')
        assertProviderUpstream(upstreamUrl)
        return {
          routeId: route.id,
          sessionId,
          endpointId: route.endpointId,
          serviceId: route.serviceId,
          logicalPort: route.logicalPort,
          generation: route.generation,
          upstreamUrl,
        }
      })
    )
  }

  private assertEnabled(ownerUserId: string) {
    if (!this.config.enabled || this.config.disabledTenantIds.has(ownerUserId)) {
      throw new Error('Managed preview ingress is disabled.')
    }
  }

  private async touchSession(session: PreviewSession) {
    const now = DateTime.utc()
    if (session.lastActivityAt > now.minus({ seconds: 30 })) return
    session.merge({
      lastActivityAt: now,
      leaseExpiresAt: now.plus({ seconds: this.config.leaseSeconds }),
      idleDeadlineAt: now.plus({ minutes: this.config.idleTimeoutMinutes }),
    })
    await session.save()
  }
}

export function opaqueRouteId(sessionId: string, serviceId: string, endpointId: string) {
  return createHmac('sha256', appKey.release())
    .update(`${sessionId}\0${serviceId}\0${endpointId}`)
    .digest('hex')
    .slice(0, 40)
}

function canonicalHostname(value: string) {
  const normalized = value.trim().toLowerCase().replace(/\.$/, '')
  if (!/^[a-z0-9.-]{1,255}$/.test(normalized)) throw new Error('Invalid preview hostname.')
  return normalized
}

function assertProviderUpstream(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    url.pathname !== '/'
  ) {
    throw new Error('Invalid provider preview upstream.')
  }
  if (!url.hostname.endsWith('.vercel.run') && !url.hostname.endsWith('.vercel.app')) {
    throw new Error('Untrusted provider preview upstream.')
  }
}
