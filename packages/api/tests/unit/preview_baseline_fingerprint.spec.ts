import {
  previewBaselineCacheKey,
  previewBaselineFingerprint,
} from '#services/preview_baselines/baseline_fingerprint'
import { test } from '@japa/runner'

test.group('preview baseline fingerprints', () => {
  test('is deterministic and invalidates every cache identity input', ({ assert }) => {
    const input = {
      projectId: 'project-1',
      baseRevision: 'a'.repeat(40),
      sanitizedTreeHash: 'b'.repeat(64),
      planHash: 'c'.repeat(64),
      lockfileHash: 'd'.repeat(64),
      runnerImageDigest: 'sha256:' + 'e'.repeat(64),
      runnerVersion: '0.2.3',
      protocolVersion: 2,
      cachePolicyVersion: '1',
    }
    const fingerprint = previewBaselineFingerprint(input)
    assert.equal(fingerprint, previewBaselineFingerprint({ ...input }))
    assert.notEqual(
      fingerprint,
      previewBaselineFingerprint({ ...input, lockfileHash: 'f'.repeat(64) })
    )
    assert.match(fingerprint, /^[a-f0-9]{64}$/)
  })

  test('shares dependency caches across source revisions only', ({ assert }) => {
    const common = {
      projectId: 'project',
      planHash: 'd'.repeat(64),
      lockfileHash: 'c'.repeat(64),
      runnerImageDigest: `sha256:${'e'.repeat(64)}`,
      runnerVersion: '0.2.11',
      protocolVersion: 3,
      cachePolicyVersion: '2',
    }
    const cacheKey = previewBaselineCacheKey(common)
    assert.equal(previewBaselineCacheKey({ ...common }), cacheKey)
    assert.notEqual(previewBaselineCacheKey({ ...common, lockfileHash: 'f'.repeat(64) }), cacheKey)
    assert.notEqual(previewBaselineCacheKey({ ...common, planHash: 'a'.repeat(64) }), cacheKey)
  })
})
