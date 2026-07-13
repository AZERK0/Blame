import User from '#models/user'
import { loginValidator } from '#validators/user'
import type { HttpContext } from '@adonisjs/core/http'
import UserTransformer from '#transformers/user_transformer'
import AccountClosureLedgerService from '#services/account_closure_ledger_service'

export default class AccessTokensController {
  async store({ request, response, serialize }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)

    const user = await User.verifyCredentials(email, password)
    const closureLedger = new AccountClosureLedgerService()
    if (user.closureRequestedAt || (await closureLedger.hasUser(user.id))) {
      return response.forbidden({
        code: 'ACCOUNT_CLOSURE_IN_PROGRESS',
        message: 'This account is closed and no longer accepts sign-ins',
      })
    }
    const token = await User.accessTokens.create(user)

    return serialize({
      user: UserTransformer.transform(user),
      token: token.value!.release(),
    })
  }

  async destroy({ auth }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.currentAccessToken) {
      await User.accessTokens.delete(user, user.currentAccessToken.identifier)
    }

    return {
      message: 'Logged out successfully',
    }
  }
}
