import { previewRuntimeConfig, type PreviewRuntimeConfig } from '#config/preview_runtime'
import PreviewSession from '#models/preview_session'
import { DateTime } from 'luxon'

export default class PreviewLeaseService {
  constructor(private readonly config: PreviewRuntimeConfig = previewRuntimeConfig()) {}

  async renew(sessionId: string, ownerUserId: string) {
    const now = DateTime.utc()
    const leaseExpiresAt = now.plus({ seconds: this.config.leaseSeconds })
    const session = await PreviewSession.query()
      .where('id', sessionId)
      .where('ownerUserId', ownerUserId)
      .firstOrFail()
    session.merge({
      lastActivityAt: now,
      leaseExpiresAt,
      idleDeadlineAt: now.plus({ minutes: this.config.idleTimeoutMinutes }),
    })
    await session.save()
    return leaseExpiresAt.toISO()!
  }

  async release(sessionId: string, ownerUserId: string) {
    const session = await PreviewSession.query()
      .where('id', sessionId)
      .where('ownerUserId', ownerUserId)
      .firstOrFail()
    session.leaseExpiresAt = null
    session.idleDeadlineAt = DateTime.utc().plus({ minutes: this.config.idleTimeoutMinutes })
    await session.save()
  }
}
