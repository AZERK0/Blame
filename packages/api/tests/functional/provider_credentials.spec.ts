import ProviderCredential from '#models/provider_credential'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type CredentialBody = {
  data: {
    id: number
    providerId: string
    label: string
    baseUrl: string | null
    apiKey?: string
  }
}

type CredentialListBody = {
  data: CredentialBody['data'][]
}

test.group('provider credentials', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('stores encrypted credentials and hides secrets from list responses', async ({ client, assert }) => {
    const user = await createUser()
    const apiKey = 'sk-test-provider-key'

    const createResponse = await client
      .post('/api/v1/providers/credentials')
      .loginAs(user)
      .json({
        providerId: 'anthropic',
        apiKey,
      })

    createResponse.assertStatus(200)
    const created = createResponse.body() as CredentialBody
    assert.equal(created.data.providerId, 'anthropic')
    assert.isUndefined(created.data.apiKey)

    const stored = await ProviderCredential.findOrFail(created.data.id)
    assert.notEqual(stored.encryptedApiKey, apiKey)
    assert.notInclude(stored.encryptedApiKey, apiKey)

    const listResponse = await client.get('/api/v1/providers/credentials').loginAs(user)
    listResponse.assertStatus(200)
    const list = listResponse.body() as unknown as CredentialListBody
    assert.lengthOf(list.data, 1)
    assert.isUndefined(list.data[0].apiKey)
  })

  test('resolves credentials for the owner only and deletes them', async ({ client, assert }) => {
    const owner = await createUser()
    const other = await createUser()

    const createResponse = await client
      .post('/api/v1/providers/credentials')
      .loginAs(owner)
      .json({
        providerId: 'openai',
        apiKey: 'sk-owner-key',
      })

    const created = createResponse.body() as CredentialBody

    const forbiddenResolve = await client
      .post('/api/v1/providers/credentials/resolve')
      .loginAs(other)
      .json({ providerId: 'openai' })

    forbiddenResolve.assertStatus(404)

    const resolveResponse = await client
      .post('/api/v1/providers/credentials/resolve')
      .loginAs(owner)
      .json({ providerId: 'openai' })

    resolveResponse.assertStatus(200)
    const resolved = resolveResponse.body() as unknown as CredentialBody
    assert.equal(resolved.data.apiKey, 'sk-owner-key')

    const deleteResponse = await client
      .delete(`/api/v1/providers/credentials/${created.data.id}`)
      .loginAs(owner)

    deleteResponse.assertStatus(204)

    const listResponse = await client.get('/api/v1/providers/credentials').loginAs(owner)
    const list = listResponse.body() as unknown as CredentialListBody
    assert.lengthOf(list.data, 0)
  })
})

function createUser() {
  return User.create({
    email: `${crypto.randomUUID()}@example.com`,
    password: 'password123',
  })
}
