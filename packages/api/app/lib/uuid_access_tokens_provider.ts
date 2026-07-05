import { uuidV7 } from '#lib/uuid_v7'
import { AccessToken, DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import type { LucidModel } from '@adonisjs/lucid/types/model'

export class UuidAccessTokensProvider<
  TokenableModel extends LucidModel,
> extends DbAccessTokensProvider<TokenableModel> {
  async create(
    user: InstanceType<TokenableModel>,
    abilities: string[] = ['*'],
    options?: { name?: string; expiresIn?: string | number }
  ) {
    const queryClient = await this.getDb()
    const id = uuidV7()
    const transientToken = AccessToken.createTransientToken(
      user.$primaryKeyValue!,
      this.tokenSecretLength,
      options?.expiresIn || this.options.expiresIn
    )
    const row = {
      id,
      tokenable_id: transientToken.userId,
      type: this.type,
      name: options?.name || null,
      hash: transientToken.hash,
      abilities: JSON.stringify(abilities),
      created_at: new Date(),
      updated_at: new Date(),
      last_used_at: null,
      expires_at: transientToken.expiresAt || null,
    }

    await queryClient.table(this.table).insert(row)
    return new AccessToken({
      identifier: id,
      tokenableId: row.tokenable_id,
      type: row.type,
      prefix: this.prefix,
      secret: transientToken.secret,
      name: row.name,
      hash: row.hash,
      abilities,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastUsedAt: row.last_used_at,
      expiresAt: row.expires_at,
    })
  }
}
