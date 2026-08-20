import Project from '#models/project'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type QuickChatBody = {
  data: {
    agentFinalResponse?: string | null
    agentRuns?: QuickChatAgentRunBody['data'][]
    id: string
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
    id: string
    quickChatId: string
  }
}

type QuickChatAgentRunBody = {
  data: {
    checkpointRunCount?: number | null
    diffEndRef?: string | null
    id: string
    kind: string
    quickChatId: string
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

  test('persists run boundaries and undoes the exact message run', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const chatResponse = await client.post('/api/v1/projects/quick-chats').loginAs(user).json({
      projectId: project.id,
      title: 'History',
    })
    const chat = chatResponse.body() as unknown as QuickChatBody
    const firstMessageResponse = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/messages`)
      .loginAs(user)
      .json({ body: 'First' })
    const firstMessage = firstMessageResponse.body() as unknown as QuickChatMessageBody
    const firstRunResponse = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/agent-runs`)
      .loginAs(user)
      .json({ checkpointRunCount: 4, kind: 'resume', messageId: firstMessage.data.id })
    const firstRun = firstRunResponse.body() as unknown as QuickChatAgentRunBody
    const ref = 'a'.repeat(40)
    const updatedRunResponse = await client
      .patch(`/api/v1/projects/quick-chats/${chat.data.id}/agent-runs/${firstRun.data.id}`)
      .loginAs(user)
      .json({ diffEndRef: ref, status: 'completed' })
    const updatedRun = updatedRunResponse.body() as unknown as QuickChatAgentRunBody
    assert.equal(updatedRun.data.checkpointRunCount, 4)
    assert.equal(updatedRun.data.diffEndRef, ref)

    const secondMessageResponse = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/messages`)
      .loginAs(user)
      .json({ body: 'Second' })
    const secondMessage = secondMessageResponse.body() as unknown as QuickChatMessageBody
    const secondRunResponse = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/agent-runs`)
      .loginAs(user)
      .json({ checkpointRunCount: 5, kind: 'resume', messageId: secondMessage.data.id })
    const secondRun = secondRunResponse.body() as unknown as QuickChatAgentRunBody

    const invalidUndo = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/messages/${firstMessage.data.id}/undo`)
      .loginAs(user)
      .json({ runId: secondRun.data.id })
    invalidUndo.assertStatus(409)

    const undoResponse = await client
      .post(`/api/v1/projects/quick-chats/${chat.data.id}/messages/${secondMessage.data.id}/undo`)
      .loginAs(user)
      .json({ runId: secondRun.data.id })
    undoResponse.assertStatus(200)
    const undone = undoResponse.body() as unknown as QuickChatBody
    assert.deepEqual(
      (undone.data.messages ?? []).map((message) => message.id),
      [firstMessage.data.id]
    )
    assert.deepEqual(
      (undone.data.agentRuns ?? []).map((run) => run.id),
      [firstRun.data.id]
    )
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
    name,
    repositoryFingerprint: crypto.randomUUID(),
    userId,
  })
}
