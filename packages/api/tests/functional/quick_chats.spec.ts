import Project from '#models/project'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type QuickChatBody = {
  data: {
    agentFinalResponse?: string | null
    agentRuns?: QuickChatAgentRunBody['data'][]
    id: number
    messages?: QuickChatMessageBody['data'][]
    title: string
  }
}

type QuickChatListBody = {
  data: QuickChatBody['data'][]
}

type QuickChatMessageBody = {
  data: {
    body: string
    id: number
    quickChatId: number
  }
}

type QuickChatAgentRunBody = {
  data: {
    id: number
    kind: string
    quickChatId: number
    status: string
  }
}

test.group('quick chats', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('lists quick chat summaries without detail payloads', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const createResponse = await client.post('/api/v1/projects/quick-chats').loginAs(user).json({
      projectId: project.id,
      title: 'Large chat',
      workspace: '/workspace',
    })
    const chat = createResponse.body() as unknown as QuickChatBody
    const messageResponse = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/messages`)
      .loginAs(user)
      .json({ body: 'Please change the layout' })
    const message = messageResponse.body() as unknown as QuickChatMessageBody

    await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/agent-runs`)
      .loginAs(user)
      .json({ kind: 'resume', messageId: message.data.id })

    const summaryResponse = await client
      .get('/api/v1/projects/quick-chats')
      .qs({ projectId: project.id, view: 'summary' })
      .loginAs(user)

    summaryResponse.assertStatus(200)
    const summary = summaryResponse.body() as unknown as QuickChatListBody
    assert.equal(summary.data[0].title, 'Large chat')
    assert.isUndefined(summary.data[0].agentFinalResponse)
    assert.isUndefined(summary.data[0].messages)
    assert.isUndefined(summary.data[0].agentRuns)

    const detailResponse = await client
      .get(`/api/v1/projects/quick-chats/${chat.data.id}`)
      .loginAs(user)

    detailResponse.assertStatus(200)
    const detail = detailResponse.body() as unknown as QuickChatBody
    assert.lengthOf(detail.data.messages ?? [], 1)
    assert.lengthOf(detail.data.agentRuns ?? [], 1)
  })
})

function createUser() {
  return User.create({
    email: `${crypto.randomUUID()}@example.com`,
    password: 'password123',
  })
}

function createProject(userId: string, name: string) {
  return Project.create({
    id: crypto.randomUUID(),
    name,
    repositoryFingerprint: crypto.randomUUID(),
    userId,
  })
}
