import {
  activityWithArtifact,
  artifactDetail,
  deleteActivityArtifacts,
} from '#services/agent_activity_artifacts'
import { test } from '@japa/runner'

test.group('agent activity artifacts', () => {
  test('keeps large details durable and scoped to their owner', async ({ assert }) => {
    const detail = 'execution evidence '.repeat(800)
    const activity = await activityWithArtifact('owner-a', 'session-a', {
      id: 'tool-call-1',
      kind: 'tool',
      title: 'Ran tests',
      detail,
      status: 'completed',
      createdAt: new Date().toISOString(),
    })

    assert.match(activity.detailArtifact ?? '', /^agent-activity:\/\//)
    assert.isBelow(activity.detail.length, detail.length)
    assert.equal(await artifactDetail('owner-a', null, activity), detail)
    assert.equal(await artifactDetail('owner-b', null, activity), activity.detail)
    await deleteActivityArtifacts('owner-a', [[activity]])
    assert.equal(await artifactDetail('owner-a', null, activity), activity.detail)
  })

  test('keeps large tool previews structured', async ({ assert }) => {
    const detail = JSON.stringify({
      input: { path: 'package.json' },
      output: { content: 'x'.repeat(20_000) },
      toolName: 'read_file',
    })
    const activity = await activityWithArtifact('owner-b', 'session-b', {
      id: 'tool-call-2',
      kind: 'tool',
      title: 'Read file',
      detail,
      status: 'completed',
      toolName: 'read_file',
      createdAt: new Date().toISOString(),
    })

    const preview = JSON.parse(activity.detail)
    assert.isBelow(activity.detail.length, 4_097)
    assert.equal(preview.toolName, 'read_file')
    assert.deepEqual(preview.input, { path: 'package.json' })
    assert.isTrue(preview.output.truncated)
    assert.equal(await artifactDetail('owner-b', null, activity), detail)
    await deleteActivityArtifacts('owner-b', [[activity]])
  })
})
