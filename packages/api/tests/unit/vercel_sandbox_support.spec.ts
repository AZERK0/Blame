import {
  providerFailure,
  providerResourceMissing,
  retryableProviderError,
} from '#services/sandboxes/vercel_sandbox_support'
import { PreviewRuntimeError } from '@blame/preview-runtime'
import { test } from '@japa/runner'

test.group('Vercel sandbox provider errors', () => {
  test('reads SDK APIError response and JSON fields', ({ assert }) => {
    const error = apiError(403, 'sandbox_not_enabled', 'sfo1::request-1')
    const result = providerFailure('create', error)

    assert.instanceOf(result, PreviewRuntimeError)
    assert.equal(result.failure.code, 'PROVIDER_AUTH')
    assert.equal(result.failure.providerCode, 'sandbox_not_enabled')
    assert.equal(result.failure.correlationId, 'sfo1::request-1')
    assert.isFalse(result.failure.retryable)
    assert.isFalse(retryableProviderError(error))
  })

  test('recognizes nested retry and not-found statuses', ({ assert }) => {
    assert.isTrue(retryableProviderError(apiError(429, 'rate_limited')))
    assert.isTrue(providerResourceMissing(apiError(404, 'not_found')))
  })
})

function apiError(status: number, code: string, requestId?: string) {
  return {
    json: { error: { code } },
    response: {
      status,
      headers: {
        get: (name: string) => (name === 'x-vercel-id' ? (requestId ?? null) : null),
      },
    },
  }
}
