import { previewCommandRequiresPremium } from '#services/premium_service'
import type { PreviewSessionCommand } from '@blame/preview-runtime'
import { test } from '@japa/runner'

test.group('Premium preview command policy', () => {
  test('requires Premium for provisioning and starting cloud work', ({ assert }) => {
    const commands: PreviewSessionCommand[] = [
      { type: 'start-services', configurationId: 'web' },
      { type: 'start-agent' },
      { type: 'resume-host' },
    ]
    for (const command of commands) assert.isTrue(previewCommandRequiresPremium(command))
  })

  test('allows stopping, deletion and recovery after expiry', ({ assert }) => {
    const commands: PreviewSessionCommand[] = [
      { type: 'stop-services' },
      { type: 'stop-agent' },
      { type: 'suspend-host' },
      { type: 'destroy-host' },
      { type: 'report-sync-conflict' },
      { type: 'ack-local-sync', deltaRevision: 'delta' },
    ]
    for (const command of commands) assert.isFalse(previewCommandRequiresPremium(command))
  })
})
