import {
  loadClineProviderCatalog,
  fetchClineLiveProviderModels,
} from '#services/cline_catalog_client'
import { test } from '@japa/runner'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'

test.group('Cline supplemental catalog worker', () => {
  test('makes Astra available for Codex while retaining the subscription allowlist', async ({
    assert,
  }) => {
    const catalog = await loadClineProviderCatalog()
    const codex = catalog.find(({ provider }) => provider.id === 'openai-codex')
    assert.isTrue(codex?.authoritativeModels)
    assert.equal(codex?.models['gpt-6-astra']?.name, 'GPT-6 Astra')
    assert.equal(codex?.models['gpt-6-astra']?.contextWindow, 872_000)
    assert.isUndefined(codex?.models['gpt-6-astra']?.pricing)
    assert.equal(
      catalog.find(({ provider }) => provider.id === 'openai-native')?.models['gpt-6-astra']
        ?.contextWindow,
      1_050_000
    )
  })

  test('a live API alias cannot replace Codex-specific supplemental metadata', async ({
    assert,
  }) => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({
          openai: {
            id: 'openai',
            name: 'OpenAI',
            models: {
              'gpt-6-astra': {
                id: 'gpt-6-astra',
                name: 'Live Astra',
                tool_call: true,
                limit: { context: 1_050_000, output: 128_000 },
                cost: { input: 10, output: 50 },
              },
            },
          },
        })
      )
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api.json`
      const live = await fetchClineLiveProviderModels(url, ['openai-native', 'openai-codex'])
      assert.equal(live['openai-native']['gpt-6-astra'].name, 'Live Astra')
      assert.equal(live['openai-codex']['gpt-6-astra'].contextWindow, 872_000)
      assert.isUndefined(live['openai-codex']['gpt-6-astra'].pricing)
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  })
})
