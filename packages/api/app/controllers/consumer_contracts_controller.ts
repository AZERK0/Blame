import ConsumerContractService from '#services/consumer_contract_service'
import { ConsumerContractError } from '#services/consumer_contract_service'
import { withdrawalValidator } from '#validators/consumer_contract'
import type { HttpContext } from '@adonisjs/core/http'

export default class ConsumerContractsController {
  async withdraw({ request, response }: HttpContext) {
    const input = await request.validateUsing(withdrawalValidator)
    return sendReceipt(response, () => new ConsumerContractService().withdraw(input))
  }
}

async function sendReceipt(
  response: HttpContext['response'],
  action: () => Promise<Record<string, unknown>>
) {
  response.header('Cache-Control', 'private, no-store')
  try {
    return response.ok(await action())
  } catch (error) {
    if (error instanceof ConsumerContractError) {
      if (error.status === 429) response.header('Retry-After', '900')
      return response.status(error.status).send({ code: error.code, message: error.message })
    }
    return response.serviceUnavailable({
      code: 'CONSUMER_CONTRACT_SERVICE_UNAVAILABLE',
      message: 'The request could not be completed. Please try again or contact support',
    })
  }
}
