import {
  baselineImportAction,
  sourceImportUnchanged,
} from '#services/preview_sessions/preview_session_service'
import type { PreviewSessionState } from '@blame/preview-runtime'
import { test } from '@japa/runner'

const metadata = {
  baseRevision: 'a'.repeat(40),
  sanitizedTreeHash: 'b'.repeat(64),
  lockfileHash: 'c'.repeat(64),
  workspaceHash: 'd'.repeat(64),
}

test.group('preview source negotiation', () => {
  test('skips an unchanged clean workspace on a reusable host', ({ assert }) => {
    assert.isTrue(sourceImportUnchanged(session(), metadata))
  })

  test('never skips a pending delta or a different workspace identity', ({ assert }) => {
    assert.isFalse(sourceImportUnchanged(session({ pendingDeltaArtifactId: 'artifact' }), metadata))
    assert.isFalse(sourceImportUnchanged(session({ workspaceHash: 'e'.repeat(64) }), metadata))
    assert.isFalse(sourceImportUnchanged(session({ sourceRevision: 'f'.repeat(40) }), metadata))
  })

  test('never skips a dirty sync state or a non-reusable host', ({ assert }) => {
    assert.isFalse(sourceImportUnchanged(session({ sync: 'conflict' }), metadata))
    assert.isFalse(sourceImportUnchanged(session({ host: 'failed' }), metadata))
  })

  test('reuses an exact baseline already provisioned on the host', ({ assert }) => {
    assert.equal(
      baselineImportAction({
        sourceMode: 'delta',
        baselineId: 'baseline-1',
        provisionedBaselineId: 'baseline-1',
      }),
      'reuse'
    )
  })

  test('restores a baseline only when the host does not already contain it', ({ assert }) => {
    assert.equal(
      baselineImportAction({
        sourceMode: 'delta',
        baselineId: 'baseline-1',
        provisionedBaselineId: 'baseline-2',
      }),
      'restore'
    )
    assert.equal(
      baselineImportAction({
        sourceMode: 'delta',
        baselineId: 'baseline-1',
        provisionedBaselineId: 'baseline-1',
        sourceArtifactId: 'artifact-1',
      }),
      'restore'
    )
  })

  test('rejects a delta only when no exact baseline exists', ({ assert }) => {
    assert.equal(baselineImportAction({ sourceMode: 'delta' }), 'unavailable')
    assert.equal(baselineImportAction({ sourceMode: 'full' }), 'none')
  })
})

function session(
  overrides: {
    host?: PreviewSessionState['host']
    sync?: PreviewSessionState['sync']
    pendingDeltaArtifactId?: string
    sourceRevision?: string
    workspaceHash?: string
  } = {}
) {
  return {
    state: {
      host: overrides.host ?? 'running',
      engine: 'stopped',
      preview: 'closed',
      agent: 'idle',
      sync: overrides.sync ?? 'clean',
    } satisfies PreviewSessionState,
    pendingDeltaArtifactId: overrides.pendingDeltaArtifactId,
    sourceRevision: overrides.sourceRevision ?? metadata.baseRevision,
    workspaceHash: overrides.workspaceHash ?? metadata.workspaceHash,
  }
}
