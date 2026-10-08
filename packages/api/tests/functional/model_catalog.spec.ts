import ModelCatalogSnapshot from '#models/model_catalog_snapshot'
import User from '#models/user'
import ProviderCredentialsService from '#services/provider_credentials_service'
import { createLicensedUser } from '#tests/helpers/create_licensed_user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

test.group('model catalog', (group) => {
  group.setup(async () => {
    await testUtils.db().migrate()
  })
  group.each.setup(() => testUtils.db().truncate())

  test('returns a protected backend catalog for connected providers', async ({
    client,
    assert,
  }) => {
    const user = await createLicensedUser()
    await new ProviderCredentialsService().save(user.id, {
      providerId: 'anthropic',
      label: 'Work',
      apiKey: 'sk-never-return-this',
    })

    const response = await client.get('/api/v1/providers/catalog').loginAs(user)

    response.assertStatus(200)
    const body = (response.body() as unknown as { data: CatalogResponse }).data
    assert.isArray(body.all)
    assert.property(body.default, 'anthropic')
    assert.property(body.recommendations.byProvider, 'anthropic')
    assert.notInclude(JSON.stringify(body), 'sk-never-return-this')
    assert.notInclude(JSON.stringify(body), 'encryptedApiKey')
    assert.isNotNull(await ModelCatalogSnapshot.find('global'))
  })

  test('allows the model catalog without a Blame subscription', async ({ client }) => {
    const user = await User.create({
      email: `${crypto.randomUUID()}@example.com`,
      password: 'password123',
    })

    const response = await client.get('/api/v1/providers/catalog').loginAs(user)

    response.assertStatus(200)
  })
})

type CatalogResponse = {
  all: unknown[]
  default: Record<string, string>
  recommendations: {
    byProvider: Record<string, unknown[]>
  }
}
