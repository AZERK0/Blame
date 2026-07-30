import ModelCatalogService from '#services/model_catalog_service'
import ProviderCredentialsService from '#services/provider_credentials_service'
import type { HttpContext } from '@adonisjs/core/http'

export default class ModelCatalogController {
  async show({ auth, serialize }: HttpContext) {
    const userId = auth.getUserOrFail().id
    const credentials = await new ProviderCredentialsService().list(userId)
    return serialize(await new ModelCatalogService().catalog(userId, credentials))
  }
}
