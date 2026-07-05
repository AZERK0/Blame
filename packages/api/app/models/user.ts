import { UserSchema } from '#database/schema'
import { UuidAccessTokensProvider } from '#lib/uuid_access_tokens_provider'
import { assignUuidV7Id } from '#lib/uuid_v7_model'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { type AccessToken } from '@adonisjs/auth/access_tokens'
import { beforeCreate } from '@adonisjs/lucid/orm'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  static selfAssignPrimaryKey = true
  static accessTokens = new UuidAccessTokensProvider({ tokenableModel: User })
  declare currentAccessToken?: AccessToken

  @beforeCreate()
  static assignId(user: User) {
    assignUuidV7Id(user)
  }

  get initials() {
    const [first, last] = this.fullName ? this.fullName.split(' ') : this.email.split('@')
    if (first && last) {
      return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
    }
    return `${first.slice(0, 2)}`.toUpperCase()
  }
}
