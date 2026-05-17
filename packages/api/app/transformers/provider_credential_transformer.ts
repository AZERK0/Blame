import type ProviderCredential from '#models/provider_credential'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class ProviderCredentialTransformer extends BaseTransformer<ProviderCredential> {
  toObject() {
    return this.pick(this.resource, [
      'id',
      'userId',
      'providerId',
      'label',
      'authMethod',
      'accountId',
      'baseUrl',
      'expiresAt',
      'createdAt',
      'updatedAt',
    ])
  }
}
