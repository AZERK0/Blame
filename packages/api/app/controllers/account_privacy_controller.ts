import AccountClosureService from '#services/account_closure_service'
import AccountExportService from '#services/account_export_service'
import AccountVerificationService from '#services/account_verification_service'
import type { AccountVerificationResult } from '#services/account_verification_service'
import {
  accountClosureStatusValidator,
  accountClosureValidator,
  accountExportValidator,
} from '#validators/account_privacy'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'

export default class AccountPrivacyController {
  async download({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const { password } = await request.validateUsing(accountExportValidator)
    const verification = await new AccountVerificationService().verifyExport(user, password)
    if (verification !== 'verified') return failedVerificationResponse(verification, response)

    const accountExport = await new AccountExportService().export(user.id)
    const date = DateTime.utc().toISODate()
    response.header('Cache-Control', 'private, no-store')
    response.header(
      'Content-Disposition',
      `attachment; filename="blame-account-export-${date}.json"`
    )
    return response.send(accountExport)
  }

  async close({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const input = await request.validateUsing(accountClosureValidator)
    const verification = await new AccountVerificationService().verifyClosure(
      user,
      input.password,
      input.confirmation
    )
    if (verification !== 'verified') return failedVerificationResponse(verification, response)

    const receipt = await new AccountClosureService().close(user)
    if (receipt.activeDeletionCompletedAt) return response.ok(receipt)
    return response.accepted(receipt)
  }

  async status({ request, response }: HttpContext) {
    const input = await request.validateUsing(accountClosureStatusValidator)
    const receipt = await new AccountClosureService().status(input.requestId, input.receiptToken)
    if (receipt) {
      response.header('Cache-Control', 'private, no-store')
      return response.ok(receipt)
    }
    return response.notFound({
      code: 'ACCOUNT_CLOSURE_RECEIPT_NOT_FOUND',
      message: 'The account closure receipt could not be verified',
    })
  }
}

function verificationFailed(response: HttpContext['response']) {
  return response.unauthorized({
    code: 'ACCOUNT_VERIFICATION_FAILED',
    message: 'The current password or account confirmation is incorrect',
  })
}

function failedVerificationResponse(
  result: Exclude<AccountVerificationResult, 'verified'>,
  response: HttpContext['response']
) {
  if (result === 'failed') return verificationFailed(response)
  response.header('Retry-After', '900')
  return response.tooManyRequests({
    code: 'ACCOUNT_VERIFICATION_RATE_LIMITED',
    message: 'Too many verification attempts. Try again later',
  })
}
