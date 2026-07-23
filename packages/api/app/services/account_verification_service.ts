import User from '#models/user'
import hash from '@adonisjs/core/services/hash'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'

const maximumFailures = 5
const verificationWindowMinutes = 15

export type AccountVerificationResult = 'verified' | 'failed' | 'blocked'

export default class AccountVerificationService {
  verifyExport(user: User, password: string) {
    return this.verify(user, password, true)
  }

  verifyClosure(user: User, password: string, confirmation: string) {
    const confirmationMatches = user.email.toLowerCase() === confirmation.trim().toLowerCase()
    return this.verify(user, password, confirmationMatches)
  }

  verifyConsumerContract(user: User, password: string) {
    return this.verify(user, password, true)
  }

  private async verify(user: User, password: string, confirmationMatches: boolean) {
    if (await this.isBlocked(user.id)) return 'blocked'
    const credential = await db
      .from('auth_accounts')
      .select('password')
      .where('user_id', user.id)
      .where('provider_id', 'credential')
      .first()
    const passwordHash = credential?.password ?? user.password
    const passwordMatches = Boolean(passwordHash && (await hash.verify(passwordHash, password)))
    if (passwordMatches && confirmationMatches) {
      await this.resetFailures(user.id)
      return 'verified'
    }
    await this.recordFailure(user.id)
    return 'failed'
  }

  private async isBlocked(userId: string) {
    const user = await User.findOrFail(userId)
    return Boolean(
      user.privacyVerificationBlockedUntil && user.privacyVerificationBlockedUntil > DateTime.utc()
    )
  }

  private resetFailures(userId: string) {
    return User.query().where('id', userId).update({
      privacyVerificationFailureCount: 0,
      privacyVerificationWindowStartedAt: null,
      privacyVerificationBlockedUntil: null,
    })
  }

  private recordFailure(userId: string) {
    return db.transaction(async (transaction) => {
      const user = await User.query({ client: transaction })
        .where('id', userId)
        .forUpdate()
        .firstOrFail()
      const now = DateTime.utc()
      const windowThreshold = now.minus({ minutes: verificationWindowMinutes })
      const withinWindow = Boolean(
        user.privacyVerificationWindowStartedAt &&
        user.privacyVerificationWindowStartedAt > windowThreshold
      )
      const failureCount = withinWindow ? user.privacyVerificationFailureCount + 1 : 1
      user.useTransaction(transaction)
      user.merge({
        privacyVerificationFailureCount: failureCount,
        privacyVerificationWindowStartedAt: withinWindow
          ? user.privacyVerificationWindowStartedAt
          : now,
        privacyVerificationBlockedUntil:
          failureCount >= maximumFailures ? now.plus({ minutes: verificationWindowMinutes }) : null,
      })
      await user.save()
    })
  }
}
