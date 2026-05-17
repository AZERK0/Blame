import ProviderCredential from '#models/provider_credential'
import encryption from '@adonisjs/core/services/encryption'
import type { Infer } from '@vinejs/vine/types'
import type {
  resolveProviderCredentialValidator,
  saveProviderCredentialValidator,
} from '#validators/provider_credential'

type SaveProviderCredentialInput = Infer<typeof saveProviderCredentialValidator>
type ResolveProviderCredentialInput = Infer<typeof resolveProviderCredentialValidator>

const defaultLabel = 'default'

export default class ProviderCredentialsService {
  async list(userId: number) {
    return ProviderCredential.query().where('userId', userId).orderBy('providerId', 'asc')
  }

  async save(userId: number, input: SaveProviderCredentialInput) {
    const label = input.label ?? defaultLabel
    const encryptedApiKey = await encryption.encrypt(input.apiKey)
    const existing = await ProviderCredential.query()
      .where('userId', userId)
      .where('providerId', input.providerId)
      .where('label', label)
      .first()

    if (!existing) {
      return ProviderCredential.create({
        userId,
        providerId: input.providerId,
        label,
        encryptedApiKey,
        baseUrl: input.baseUrl ?? null,
      })
    }

    existing.merge({
      encryptedApiKey,
      baseUrl: input.baseUrl ?? null,
    })
    await existing.save()
    return existing
  }

  async resolve(userId: number, input: ResolveProviderCredentialInput) {
    const credential = await ProviderCredential.query()
      .where('userId', userId)
      .where('providerId', input.providerId)
      .where('label', input.label ?? defaultLabel)
      .firstOrFail()
    return {
      id: credential.id,
      providerId: credential.providerId,
      label: credential.label,
      apiKey: await encryption.decrypt(credential.encryptedApiKey),
      baseUrl: credential.baseUrl,
    }
  }

  async delete(userId: number, id: number) {
    const credential = await ProviderCredential.query().where('userId', userId).where('id', id).firstOrFail()
    await credential.delete()
  }
}
