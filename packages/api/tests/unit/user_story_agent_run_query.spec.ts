import UserStoryAgentRun from '#models/user_story_agent_run'
import { runningAgentRunSummaries } from '#services/user_stories_service'
import { test } from '@japa/runner'

test.group('user story agent run queries', () => {
  test('uses the relation order index without selecting activity payloads', ({ assert }) => {
    const query = UserStoryAgentRun.query()
    runningAgentRunSummaries(query)
    const compiled = query.toSQL()

    assert.include(compiled.sql, 'where `status` = ?')
    assert.include(compiled.sql, 'order by `user_story_id` asc, `created_at` asc, `id` asc')
    assert.notInclude(compiled.sql, '`activities`')
    assert.notInclude(compiled.sql, 'select *')
  })
})
