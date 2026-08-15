import VercelConnectionsService, {
  safeVercelNext,
  serializeVercelConnection,
  serializeVercelProject,
} from '#services/deployments/vercel_connections_service'
import type { HttpContext } from '@adonisjs/core/http'
import { Exception } from '@adonisjs/core/exceptions'

export default class VercelConnectionsController {
  async createIntent({ auth }: HttpContext) {
    const intent = await new VercelConnectionsService().createIntent(auth.getUserOrFail().id)
    return { url: intent.url, expiresAt: intent.expiresAt.toISO() }
  }

  async callback({ request, response }: HttpContext) {
    const state = input(request.input('state'), 128)
    const code = input(request.input('code'), 2_048)
    const configurationId = input(request.input('configurationId'), 160)
    const teamId = optionalInput(request.input('teamId'), 160)
    await new VercelConnectionsService().callback({ state, code, configurationId, teamId })
    response.header('Location', safeVercelNext(optionalInput(request.input('next'), 2_048)))
    return response.status(302).send(null)
  }

  async index({ auth }: HttpContext) {
    const connections = await new VercelConnectionsService().list(auth.getUserOrFail().id)
    return {
      connections: connections.map(serializeVercelConnection),
    }
  }

  async projects({ auth, params, request }: HttpContext) {
    const result = await new VercelConnectionsService().projects(
      auth.getUserOrFail().id,
      params.id,
      optionalInput(request.input('cursor'), 160)
    )
    return {
      projects: result.projects.map(serializeVercelProject),
      nextCursor: result.nextCursor,
    }
  }

  async destroy({ auth, params, response }: HttpContext) {
    await new VercelConnectionsService().unlink(auth.getUserOrFail().id, params.id)
    return response.noContent()
  }
}

function input(value: unknown, maximum: number) {
  if (typeof value !== 'string' || !value || value.length > maximum) {
    throw new Exception('Vercel callback is invalid', {
      status: 400,
      code: 'E_VERCEL_CALLBACK_INVALID',
    })
  }
  return value
}

function optionalInput(value: unknown, maximum: number) {
  return value === undefined ? undefined : input(value, maximum)
}
