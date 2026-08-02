import env from '#start/env'
import PreviewEdgeRouteService from '#services/preview_gateway/preview_edge_route_service'
import PreviewAccessTicketService from '#services/preview_gateway/preview_access_ticket_service'
import type { HttpContext } from '@adonisjs/core/http'
import { timingSafeEqual } from 'node:crypto'

const routes = new PreviewEdgeRouteService()
const tickets = new PreviewAccessTicketService()

export default class PreviewEdgeInternalController {
  async resolve(context: HttpContext) {
    if (!authorized(context)) return context.response.unauthorized()
    try {
      return await routes.resolve(requiredHostname(context.request.input('hostname')))
    } catch {
      return context.response.notFound()
    }
  }

  async consumeTicket(context: HttpContext) {
    if (!authorized(context)) return context.response.unauthorized()
    try {
      return await tickets.consumeForEdge(
        requiredTicket(context.request.input('ticket')),
        requiredHostname(context.request.input('hostname'))
      )
    } catch {
      return context.response.unauthorized()
    }
  }
}

function authorized({ request }: HttpContext) {
  const expected = env.get('BLAME_PREVIEW_EDGE_CONTROL_TOKEN')?.release()
  const actual = request.header('authorization')?.match(/^Bearer ([A-Za-z0-9._-]+)$/)?.[1]
  if (!expected || !actual) return false
  const left = Buffer.from(expected)
  const right = Buffer.from(actual)
  return left.length === right.length && timingSafeEqual(left, right)
}

function requiredHostname(value: unknown) {
  if (typeof value !== 'string' || !/^[a-z0-9.-]{1,255}$/.test(value)) {
    throw new Error('Invalid hostname.')
  }
  return value
}

function requiredTicket(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(value)) {
    throw new Error('Invalid ticket.')
  }
  return value
}
