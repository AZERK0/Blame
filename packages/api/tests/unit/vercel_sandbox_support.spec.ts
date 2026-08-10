import {
  effectiveSandboxTimeoutMinutes,
  ownedSnapshotIdForDeletion,
  providerFailure,
  providerResourceMissing,
  providerSnapshotMissing,
  retryableProviderError,
  vercelPlanLimits,
} from '#services/sandboxes/vercel_sandbox_support'
import { PreviewRuntimeError } from '@blame/preview-runtime'
import { test } from '@japa/runner'

test.group('Vercel sandbox provider errors', () => {
  test('reads SDK APIError response and JSON fields', ({ assert }) => {
    const error = apiError(
      403,
      'sandbox_not_enabled',
      'sfo1::request-1',
      'Access token=vcp_private and https://example.test/details are invalid'
    )
    const result = providerFailure('create', error)

    assert.instanceOf(result, PreviewRuntimeError)
    assert.equal(result.failure.code, 'PROVIDER_AUTH')
    assert.equal(result.failure.providerCode, 'sandbox_not_enabled')
    assert.equal(result.failure.correlationId, 'sfo1::request-1')
    assert.equal(
      result.failure.message,
      'Vercel Sandbox create failed: Access token=[redacted-token] and [redacted-url] are invalid'
    )
    assert.isFalse(result.failure.retryable)
    assert.isFalse(retryableProviderError(error))
  })

  test('recognizes nested retry and not-found statuses', ({ assert }) => {
    assert.isTrue(retryableProviderError(apiError(429, 'rate_limited')))
    assert.isTrue(providerResourceMissing(apiError(404, 'not_found')))
  })

  test('normalizes an expired baseline snapshot returned as a bad request', ({ assert }) => {
    const error = apiError(400, 'bad_request', undefined, 'Snapshot expired or deleted.')
    const result = providerFailure('baseline-restore', error)

    assert.equal(result.failure.code, 'PROVIDER_UNAVAILABLE')
    assert.equal(result.failure.providerCode, 'BASELINE_SNAPSHOT_NOT_FOUND')
    assert.isFalse(result.failure.retryable)
    assert.isTrue(providerSnapshotMissing(error))
    assert.isTrue(providerSnapshotMissing(result))
    assert.isFalse(
      providerSnapshotMissing(apiError(400, 'bad_request', undefined, 'Snapshot is malformed.'))
    )
  })

  test('caps requested session duration to the configured Vercel plan', ({ assert }) => {
    assert.equal(effectiveSandboxTimeoutMinutes(60, 'hobby'), 45)
    assert.equal(effectiveSandboxTimeoutMinutes(60, 'pro'), 60)
    assert.deepEqual(vercelPlanLimits('enterprise'), {
      maxDurationMinutes: 24 * 60,
      maxVcpus: 32,
    })
  })

  test('only deletes a snapshot owned by an inactive sandbox', ({ assert }) => {
    assert.equal(ownedSnapshotIdForDeletion('stopped', 'snap_private'), 'snap_private')
    assert.equal(ownedSnapshotIdForDeletion('failed', 'snap_private'), 'snap_private')
    assert.isUndefined(ownedSnapshotIdForDeletion('running', 'snap_shared_baseline'))
    assert.isUndefined(ownedSnapshotIdForDeletion('snapshotting', 'snap_private'))
  })
})

function apiError(status: number, code: string, requestId?: string, message?: string) {
  return {
    json: { error: { code, message } },
    response: {
      status,
      headers: {
        get: (name: string) => (name === 'x-vercel-id' ? (requestId ?? null) : null),
      },
    },
  }
}
