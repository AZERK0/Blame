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
})
