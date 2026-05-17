import Project from '#models/project'
import User from '#models/user'
import testUtils from '@adonisjs/core/services/test_utils'
import { test } from '@japa/runner'

type UserStoryBody = {
  data: {
    id: number
    priority: string
    status: string
    title: string
  }
}

type UserStoryListBody = {
  data: UserStoryBody['data'][]
}

test.group('user stories', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(() => testUtils.db().truncate())

  test('lists stories for one project', async ({ client, assert }) => {
    const user = await createUser()
    const alpha = await createProject(user.id, 'Alpha')
    const beta = await createProject(user.id, 'Beta')

    await client
      .post('/api/v1/projects/user-stories')
      .loginAs(user)
      .json({
        projectId: alpha.id,
        title: 'Alpha story',
        summary: 'Alpha summary',
      })

    await client
      .post('/api/v1/projects/user-stories')
      .loginAs(user)
      .json({
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
      })

    createResponse.assertStatus(200)
    const created = createResponse.body() as UserStoryBody
    assert.equal(created.data.status, 'backlog')
    assert.equal(created.data.priority, 'Medium')

    const updateResponse = await client
      .patch(`/api/v1/projects/user-stories/${created.data.id}`)
      .loginAs(user)
      .json({
        title: 'Persisted draft',
        status: 'ready',
        priority: 'High',
      })

    updateResponse.assertStatus(200)
    const updated = updateResponse.body() as UserStoryBody
    assert.equal(updated.data.title, 'Persisted draft')
    assert.equal(updated.data.status, 'ready')
    assert.equal(updated.data.priority, 'High')

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
})

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
