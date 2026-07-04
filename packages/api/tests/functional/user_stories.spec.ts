import Project from '#models/project'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'

type UserStoryBody = {
  data: {
    comments?: UserStoryCommentBody['data'][]
    agentRuns?: UserStoryAgentRunBody['data'][]
    agentActivities?: {
      detail: string
      detailArtifact?: string
      id: string
      originalDetailLength?: number
    }[]
    agentUsage?: {
      inputTokens: number
      totalInputTokens: number
    }
    id: number
    priority: string
    status: string
    codeSelectionAttachments?: CodeSelectionAttachment[]
    fileAttachments?: FileAttachment[]
    baseCommit?: string | null
    mergeCommit?: string | null
    title: string
  }
}

type UserStoryListBody = {
  data: UserStoryBody['data'][]
}

type UserStoryCommentBody = {
  data: {
    author: string
    body: string
    codeSelectionAttachments?: CodeSelectionAttachment[]
    fileAttachments?: FileAttachment[]
    id: number
    userStoryId: number
  }
}

type CodeSelectionAttachment = {
  id: string
  content: string
  endLine: number
  path: string
  startLine: number
}

type FileAttachment = {
  id: string
  content: string
  name: string
  size: number
  type: string
}

type UserStoryAgentRunBody = {
  data: {
    activities?: {
      detail: string
      detailArtifact?: string
      id: string
      originalDetailLength?: number
    }[]
    commentId?: number | null
    finalResponse?: string | null
    id: number
    kind: string
    status: string
    userStoryId: number
    usage?: {
      inputTokens: number
      totalInputTokens: number
    } | null
  }
}

type AgentActivityDetailBody = {
  detail: string
}

test.group('user stories', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('lists stories for one project', async ({ client, assert }) => {
    const user = await createUser()
    const alpha = await createProject(user.id, 'Alpha')
    const beta = await createProject(user.id, 'Beta')

    await client.post('/api/v1/projects/user-stories').loginAs(user).json({
      projectId: alpha.id,
      title: 'Alpha story',
      summary: 'Alpha summary',
    })

    await client.post('/api/v1/projects/user-stories').loginAs(user).json({
      projectId: beta.id,
      title: 'Beta story',
      summary: 'Beta summary',
    })

    const response = await client
      .get('/api/v1/projects/user-stories')
      .qs({ projectId: alpha.id })
      .loginAs(user)

    response.assertStatus(200)
    const body = response.body() as unknown as UserStoryListBody
    assert.lengthOf(body.data, 1)
    assert.equal(body.data[0].title, 'Alpha story')
  })

  test('lists story summaries without detail payloads', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const story = await client
      .post('/api/v1/projects/user-stories')
      .loginAs(user)
      .json({
        projectId: project.id,
        title: 'Large story',
        summary: 'Large summary',
        codeSelectionAttachments: [
          {
            id: 'selection-1',
            content: 'const value = true',
            endLine: 12,
            path: 'src/example.ts',
            startLine: 10,
          },
        ],
        fileAttachments: [
          {
            id: 'file-1',
            content: 'SGVsbG8=',
            name: 'hello.txt',
            size: 5,
            type: 'text/plain',
          },
        ],
      })
    const created = story.body() as unknown as UserStoryBody

    await client
      .post(`/api/v1/projects/user-stories/${created.data.id}/comments`)
      .loginAs(user)
      .json({ body: 'Feedback' })
    await client
      .post(`/api/v1/projects/user-stories/${created.data.id}/agent-runs`)
      .loginAs(user)
      .json({ kind: 'initial' })

    const summaryResponse = await client
      .get('/api/v1/projects/user-stories')
      .qs({ projectId: project.id, view: 'summary' })
      .loginAs(user)

    summaryResponse.assertStatus(200)
    const summary = summaryResponse.body() as unknown as UserStoryListBody
    assert.equal(summary.data[0].title, 'Large story')
    assert.isUndefined(summary.data[0].codeSelectionAttachments)
    assert.isUndefined(summary.data[0].fileAttachments)
    assert.isUndefined(summary.data[0].comments)
    assert.isUndefined(summary.data[0].agentRuns)

    const detailResponse = await client
      .get(`/api/v1/projects/user-stories/${created.data.id}`)
      .loginAs(user)

    detailResponse.assertStatus(200)
    const detail = detailResponse.body() as unknown as UserStoryBody
    assert.lengthOf(detail.data.codeSelectionAttachments ?? [], 1)
    assert.lengthOf(detail.data.fileAttachments ?? [], 1)
    assert.lengthOf(detail.data.comments ?? [], 1)
    assert.lengthOf(detail.data.agentRuns ?? [], 1)
  })

  test('creates updates and deletes a story', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')

    const createResponse = await client
      .post('/api/v1/projects/user-stories')
      .loginAs(user)
      .json({
        projectId: project.id,
        title: 'Persist draft',
        summary: 'Initial summary',
        codeSelectionAttachments: [
          {
            id: 'selection-1',
            content: 'const value = true',
            endLine: 12,
            path: 'src/example.ts',
            startLine: 10,
          },
        ],
        fileAttachments: [
          {
            id: 'file-1',
            content: 'SGVsbG8=',
            name: 'hello.txt',
            size: 5,
            type: 'text/plain',
          },
        ],
      })

    createResponse.assertStatus(200)
    const created = createResponse.body() as unknown as UserStoryBody
    assert.equal(created.data.status, 'backlog')
    assert.equal(created.data.priority, 'Medium')
    assert.deepEqual(created.data.codeSelectionAttachments, [
      {
        id: 'selection-1',
        content: 'const value = true',
        endLine: 12,
        path: 'src/example.ts',
        startLine: 10,
      },
    ])
    assert.deepEqual(created.data.fileAttachments, [
      {
        id: 'file-1',
        content: 'SGVsbG8=',
        name: 'hello.txt',
        size: 5,
        type: 'text/plain',
      },
    ])

    const updateResponse = await client
      .patch(`/api/v1/projects/user-stories/${created.data.id}`)
      .loginAs(user)
      .json({
        title: 'Persisted draft',
        status: 'ready',
        priority: 'High',
        baseCommit: '1111111111111111111111111111111111111111',
        mergeCommit: '2222222222222222222222222222222222222222',
        codeSelectionAttachments: [
          {
            id: 'selection-2',
            content: 'return value',
            endLine: 22,
            path: 'src/updated.ts',
            startLine: 20,
          },
        ],
        fileAttachments: [
          {
            id: 'file-2',
            content: 'VXBkYXRlZA==',
            name: 'updated.txt',
            size: 7,
            type: 'text/plain',
          },
        ],
      })

    updateResponse.assertStatus(200)
    const updated = updateResponse.body() as UserStoryBody
    assert.equal(updated.data.title, 'Persisted draft')
    assert.equal(updated.data.status, 'ready')
    assert.equal(updated.data.priority, 'High')
    assert.equal(updated.data.baseCommit, '1111111111111111111111111111111111111111')
    assert.equal(updated.data.mergeCommit, '2222222222222222222222222222222222222222')
    assert.deepEqual(updated.data.codeSelectionAttachments, [
      {
        id: 'selection-2',
        content: 'return value',
        endLine: 22,
        path: 'src/updated.ts',
        startLine: 20,
      },
    ])
    assert.deepEqual(updated.data.fileAttachments, [
      {
        id: 'file-2',
        content: 'VXBkYXRlZA==',
        name: 'updated.txt',
        size: 7,
        type: 'text/plain',
      },
    ])

    const showResponse = await client
      .get(`/api/v1/projects/user-stories/${created.data.id}`)
      .loginAs(user)

    showResponse.assertStatus(200)
    const shown = showResponse.body() as UserStoryBody
    assert.equal(shown.data.id, created.data.id)

    const deleteResponse = await client
      .delete(`/api/v1/projects/user-stories/${created.data.id}`)
      .loginAs(user)

    deleteResponse.assertStatus(204)

    const listResponse = await client
      .get('/api/v1/projects/user-stories')
      .qs({ projectId: project.id })
      .loginAs(user)

    listResponse.assertStatus(200)
    const list = listResponse.body() as unknown as UserStoryListBody
    assert.lengthOf(list.data, 0)
  })

  test('creates and lists story comments in order', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const story = await createStory(client, user, project.id)

    const firstResponse = await client
      .post(`/api/v1/projects/user-stories/${story.data.id}/comments`)
      .loginAs(user)
      .json({
        body: 'First feedback',
        codeSelectionAttachments: [
          {
            id: 'comment-selection-1',
            content: 'displayComment()',
            endLine: 4,
            path: 'src/comment.ts',
            startLine: 4,
          },
        ],
        fileAttachments: [
          {
            id: 'comment-file-1',
            content: 'Y29tbWVudA==',
            name: 'comment.txt',
            size: 7,
            type: 'text/plain',
          },
        ],
      })

    firstResponse.assertStatus(200)
    const first = firstResponse.body() as UserStoryCommentBody
    assert.equal(first.data.body, 'First feedback')
    assert.equal(first.data.author, 'Product')
    assert.equal(first.data.userStoryId, story.data.id)
    assert.deepEqual(first.data.codeSelectionAttachments, [
      {
        id: 'comment-selection-1',
        content: 'displayComment()',
        endLine: 4,
        path: 'src/comment.ts',
        startLine: 4,
      },
    ])
    assert.deepEqual(first.data.fileAttachments, [
      {
        id: 'comment-file-1',
        content: 'Y29tbWVudA==',
        name: 'comment.txt',
        size: 7,
        type: 'text/plain',
      },
    ])

    await client
      .post(`/api/v1/projects/user-stories/${story.data.id}/comments`)
      .loginAs(user)
      .json({ body: 'Second feedback' })

    const showResponse = await client
      .get(`/api/v1/projects/user-stories/${story.data.id}`)
      .loginAs(user)

    showResponse.assertStatus(200)
    const shown = showResponse.body() as UserStoryBody
    assert.deepEqual(
      shown.data.comments?.map((comment) => comment.body),
      ['First feedback', 'Second feedback']
    )

    const listResponse = await client
      .get('/api/v1/projects/user-stories')
      .qs({ projectId: project.id })
      .loginAs(user)

    listResponse.assertStatus(200)
    const list = listResponse.body() as unknown as UserStoryListBody
    assert.deepEqual(
      list.data[0].comments?.map((comment) => comment.body),
      ['First feedback', 'Second feedback']
    )
  })

  test('rejects blank story comments', async ({ client }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const story = await createStory(client, user, project.id)

    const response = await client
      .post(`/api/v1/projects/user-stories/${story.data.id}/comments`)
      .loginAs(user)
      .json({ body: '   ' })

    response.assertStatus(422)
  })

  test('prevents commenting on another users story', async ({ client }) => {
    const owner = await createUser()
    const stranger = await createUser()
    const project = await createProject(owner.id, 'Alpha')
    const story = await createStory(client, owner, project.id)

    const response = await client
      .post(`/api/v1/projects/user-stories/${story.data.id}/comments`)
      .loginAs(stranger)
      .json({ body: 'Unauthorized feedback' })

    response.assertStatus(404)
  })

  test('creates updates and lists story agent runs in order', async ({ client, assert }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const story = await createStory(client, user, project.id)
    const commentResponse = await client
      .post(`/api/v1/projects/user-stories/${story.data.id}/comments`)
      .loginAs(user)
      .json({ body: 'Please adjust the layout' })
    const comment = commentResponse.body() as UserStoryCommentBody
    const worktree = await mkdtemp(join(tmpdir(), 'blame-story-run-'))
    const detail = `Run command\n${'y'.repeat(7000)}`

    try {
      await client
        .patch(`/api/v1/projects/user-stories/${story.data.id}`)
        .loginAs(user)
        .json({ worktree })

      const initialResponse = await client
        .post(`/api/v1/projects/user-stories/${story.data.id}/agent-runs`)
        .loginAs(user)
        .json({
          clineSessionId: 'initial-session',
          kind: 'initial',
        })

      initialResponse.assertStatus(200)
      const initialRun = initialResponse.body() as UserStoryAgentRunBody
      assert.equal(initialRun.data.kind, 'initial')
      assert.equal(initialRun.data.status, 'running')

      const changeResponse = await client
        .post(`/api/v1/projects/user-stories/${story.data.id}/agent-runs`)
        .loginAs(user)
        .json({
          clineSessionId: 'change-session',
          commentId: comment.data.id,
          kind: 'change-request',
        })

      changeResponse.assertStatus(200)
      const changeRun = changeResponse.body() as UserStoryAgentRunBody
      assert.equal(changeRun.data.commentId, comment.data.id)

      const updateResponse = await client
        .patch(`/api/v1/projects/user-stories/${story.data.id}/agent-runs/${changeRun.data.id}`)
        .loginAs(user)
        .json({
          agentActivity: {
            createdAt: new Date().toISOString(),
            detail,
            id: 'tool-run-command',
            kind: 'tool',
            status: 'completed',
            title: 'Ran command',
          },
          finalResponse: 'Updated implementation.',
          status: 'completed',
          usage: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0.01,
            inputTokens: 1000,
            outputTokens: 100,
            totalCacheReadTokens: 0,
            totalCacheWriteTokens: 0,
            totalCost: 0.01,
            totalInputTokens: 1000,
            totalOutputTokens: 100,
          },
        })

      updateResponse.assertStatus(200)
      const updated = updateResponse.body() as UserStoryAgentRunBody
      assert.equal(updated.data.status, 'completed')
      assert.equal(updated.data.finalResponse, 'Updated implementation.')
      assert.lengthOf(updated.data.activities ?? [], 1)
      assert.isBelow(updated.data.activities?.[0]?.detail.length ?? 0, detail.length)
      assert.equal(updated.data.activities?.[0]?.originalDetailLength, detail.length)
      assert.include(updated.data.activities?.[0]?.detailArtifact ?? '', 'change-session')
      assert.equal(updated.data.usage?.inputTokens, 1000)

      const detailResponse = await client
        .get(
          `/api/v1/projects/user-stories/${story.data.id}/agent-runs/${changeRun.data.id}/activities/tool-run-command`
        )
        .loginAs(user)

      detailResponse.assertStatus(200)
      assert.equal((detailResponse.body() as AgentActivityDetailBody).detail, detail)

      const showResponse = await client
        .get(`/api/v1/projects/user-stories/${story.data.id}`)
        .loginAs(user)

      showResponse.assertStatus(200)
      const shown = showResponse.body() as UserStoryBody
      assert.deepEqual(
        shown.data.agentRuns?.map((run) => run.kind),
        ['initial', 'change-request']
      )

      const listResponse = await client
        .get('/api/v1/projects/user-stories')
        .qs({ projectId: project.id })
        .loginAs(user)

      listResponse.assertStatus(200)
      const list = listResponse.body() as unknown as UserStoryListBody
      assert.deepEqual(
        list.data[0].agentRuns?.map((run) => run.kind),
        ['initial', 'change-request']
      )
    } finally {
      await rm(worktree, { force: true, recursive: true })
    }
  })

  test('prevents accessing another users story agent runs', async ({ client }) => {
    const owner = await createUser()
    const stranger = await createUser()
    const project = await createProject(owner.id, 'Alpha')
    const story = await createStory(client, owner, project.id)
    const runResponse = await client
      .post(`/api/v1/projects/user-stories/${story.data.id}/agent-runs`)
      .loginAs(owner)
      .json({ kind: 'initial' })
    const run = runResponse.body() as UserStoryAgentRunBody

    const updateResponse = await client
      .patch(`/api/v1/projects/user-stories/${story.data.id}/agent-runs/${run.data.id}`)
      .loginAs(stranger)
      .json({ status: 'completed' })

    updateResponse.assertStatus(404)

    const detailResponse = await client
      .get(
        `/api/v1/projects/user-stories/${story.data.id}/agent-runs/${run.data.id}/activities/missing`
      )
      .loginAs(stranger)

    detailResponse.assertStatus(404)
  })

  test('merges agent activity deltas and serves large details lazily', async ({
    assert,
    client,
  }) => {
    const user = await createUser()
    const project = await createProject(user.id, 'Alpha')
    const story = await createStory(client, user, project.id)
    const worktree = await mkdtemp(join(tmpdir(), 'blame-story-'))
    const detail = `Read files\n${'x'.repeat(7000)}`

    try {
      await client
        .patch(`/api/v1/projects/user-stories/${story.data.id}`)
        .loginAs(user)
        .json({ clineSessionId: 'session-1', worktree })

      const updateResponse = await client
        .patch(`/api/v1/projects/user-stories/${story.data.id}`)
        .loginAs(user)
        .json({
          agentActivity: {
            createdAt: new Date().toISOString(),
            detail,
            id: 'tool-large-read',
            kind: 'tool',
            status: 'completed',
            title: 'Read files',
          },
          agentUsage: {
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0.01,
            inputTokens: 1000,
            outputTokens: 100,
            totalCacheReadTokens: 0,
            totalCacheWriteTokens: 0,
            totalCost: 0.01,
            totalInputTokens: 1000,
            totalOutputTokens: 100,
          },
        })

      updateResponse.assertStatus(200)
      const updated = updateResponse.body() as UserStoryBody
      assert.lengthOf(updated.data.agentActivities ?? [], 1)
      assert.isBelow(updated.data.agentActivities?.[0]?.detail.length ?? 0, detail.length)
      assert.equal(updated.data.agentActivities?.[0]?.originalDetailLength, detail.length)
      assert.include(updated.data.agentActivities?.[0]?.detailArtifact ?? '', 'session-1')
      assert.equal(updated.data.agentUsage?.inputTokens, 1000)

      const detailResponse = await client
        .get(`/api/v1/projects/user-stories/${story.data.id}/agent-activities/tool-large-read`)
        .loginAs(user)

      detailResponse.assertStatus(200)
      assert.equal((detailResponse.body() as AgentActivityDetailBody).detail, detail)
    } finally {
      await rm(worktree, { force: true, recursive: true })
    }
  })
})

async function createStory(
  client: ApiClient,
  user: Awaited<ReturnType<typeof createUser>>,
  projectId: string
) {
  const response = await client.post('/api/v1/projects/user-stories').loginAs(user).json({
    projectId,
    title: 'Reviewable story',
    summary: 'Initial summary',
  })

  response.assertStatus(200)
  return response.body() as unknown as UserStoryBody
}

function createUser() {
  return User.create({
    email: `${crypto.randomUUID()}@example.com`,
    password: 'password123',
  })
}

function createProject(userId: number, name: string) {
  return Project.create({
    id: crypto.randomUUID(),
    name,
    repositoryFingerprint: crypto.randomUUID(),
    userId,
  })
}
