import TelemetryIngestionService, {
  TelemetryPayloadTooLargeError,
  type TelemetrySignal,
} from '#services/telemetry_ingestion_service'
import TelemetryRateLimiter from '#services/telemetry_rate_limiter'
import TelemetryTokenService from '#services/telemetry_token_service'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'

const ingestionService = new TelemetryIngestionService()
const tokenService = new TelemetryTokenService()
const rateLimiter = new TelemetryRateLimiter(
  requestLimit(env.get('BLAME_TELEMETRY_REQUESTS_PER_MINUTE'))
)

export default class TelemetryIngestionController {
  async store(context: HttpContext) {
    const signal = telemetrySignal(context.request.param('signal'))
    if (!signal) return context.response.notFound()
    if (!validContentType(context)) return unsupportedMediaType(context)
    const claims = tokenService.verify(bearerToken(context) ?? '')
    if (!claims) return unauthorized(context)
    if (!rateLimiter.allow(claims.sub)) return rateLimited(context)
    if (!ingestionService.payloadFits(context.request)) return payloadTooLarge(context)
    return forwardPayload(context, signal)
  }
}

async function forwardPayload(context: HttpContext, signal: TelemetrySignal) {
  try {
    const payload = await ingestionService.readPayload(context.request)
    const result = await ingestionService.forward(signal, payload)
    context.response.header('content-type', result.contentType)
    return context.response.status(result.status).send(result.body)
  } catch (error) {
    if (error instanceof TelemetryPayloadTooLargeError) return payloadTooLarge(context)
    context.logger.warn({ event_name: 'blame.telemetry.upstream_unavailable' })
    return context.response.serviceUnavailable({ message: 'Telemetry ingestion unavailable' })
  }
}

function telemetrySignal(value: string | undefined): TelemetrySignal | null {
  return value === 'logs' || value === 'metrics' || value === 'traces' ? value : null
}

function validContentType({ request }: HttpContext) {
  return request.header('content-type')?.split(';')[0].trim() === 'application/x-protobuf'
}

function bearerToken({ request }: HttpContext) {
  const authorization = request.header('authorization')
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._-]+)$/)
  return match?.[1]
}

function unauthorized({ response }: HttpContext) {
  response.header('WWW-Authenticate', 'Bearer')
  return response.unauthorized({ message: 'Invalid telemetry token' })
}

function unsupportedMediaType({ response }: HttpContext) {
  return response.status(415).send({ message: 'OTLP protobuf is required' })
}

function rateLimited({ response }: HttpContext) {
  response.header('Retry-After', '60')
  return response.tooManyRequests({ message: 'Telemetry ingestion rate exceeded' })
}

function payloadTooLarge({ response }: HttpContext) {
  return response.status(413).send({ message: 'Telemetry payload is too large' })
}

function requestLimit(value: number | undefined) {
  if (value === undefined) return 120
  if (!Number.isInteger(value) || value < 1)
    throw new Error('Telemetry rate limit must be positive')
  return value
}
