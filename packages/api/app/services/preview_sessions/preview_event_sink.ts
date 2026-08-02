import PreviewEvent from '#models/preview_event'
import PreviewSession from '#models/preview_session'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import type {
  PreviewEventSink,
  PreviewSessionEvent,
  PreviewSessionState,
} from '@blame/preview-runtime'

export default class DatabasePreviewEventSink implements PreviewEventSink {
  async append(event: Omit<PreviewSessionEvent, 'cursor' | 'sequence'>) {
    const model = await db.transaction(async (transaction) => {
      const session = await PreviewSession.query({ client: transaction })
        .where('id', event.sessionId)
        .forUpdate()
        .firstOrFail()
      const last = await PreviewEvent.query({ client: transaction })
        .where('sessionId', event.sessionId)
        .orderBy('sequence', 'desc')
        .first()
      return PreviewEvent.create(
        {
          sessionId: event.sessionId,
          generation: Number(session.generation),
          sequence: (last?.sequence ?? 0) + 1,
          type: event.type,
          state: JSON.stringify(event.state),
          serviceId: event.serviceId ?? null,
          stream: event.stream ?? null,
          message: redactPreviewMessage(event.message),
          createdAt: DateTime.fromISO(event.timestamp),
        },
        { client: transaction }
      )
    })
    return eventRecord(model)
  }

  async *events(sessionId: string, cursor?: string) {
    const sequence = safeCursor(cursor)
    const models = await PreviewEvent.query()
      .where('sessionId', sessionId)
      .where('sequence', '>', sequence)
      .orderBy('sequence', 'asc')
      .limit(1000)
    for (const model of models) yield eventRecord(model)
  }
}

function eventRecord(model: PreviewEvent): PreviewSessionEvent {
  return {
    cursor: String(model.sequence),
    sessionId: model.sessionId,
    sequence: model.sequence,
    timestamp: model.createdAt.toUTC().toISO()!,
    type: model.type as PreviewSessionEvent['type'],
    state: JSON.parse(model.state) as PreviewSessionState,
    serviceId: model.serviceId ?? undefined,
    stream: (model.stream as PreviewSessionEvent['stream']) ?? undefined,
    message: model.message,
  }
}

function safeCursor(cursor?: string) {
  const value = Number(cursor ?? 0)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function redactPreviewMessage(message: string) {
  return message
    .replace(/(?:https?:\/\/)[^\s]+/gi, '[redacted-url]')
    .replace(/(token|authorization|password|secret)=?\s*[^\s]+/gi, '$1=[redacted]')
    .slice(0, 16_384)
}
