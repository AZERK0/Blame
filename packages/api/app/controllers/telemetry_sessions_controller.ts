import TelemetryTokenService from '#services/telemetry_token_service'
import env from '#start/env'
import type { HttpContext } from '@adonisjs/core/http'

export default class TelemetrySessionsController {
  show({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    return {
      endpoint: env.get('BLAME_TELEMETRY_PUBLIC_ENDPOINT'),
      ...new TelemetryTokenService().issue(user.id),
    }
  }
}
