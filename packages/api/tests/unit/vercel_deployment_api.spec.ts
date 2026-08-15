import { test } from '@japa/runner'
import {
  VercelApiClient,
  exchangeVercelInstallationCode,
  vercelFileSha,
} from '#services/deployments/vercel_api_client'

test.group('Vercel deployment API adapter', () => {
  test('keeps team scope and production target on every provider operation', async ({ assert }) => {
    const requests: Array<{ url: URL; init?: RequestInit }> = []
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(String(input))
      requests.push({ url, init })
      if (url.pathname === '/v2/files') return json({})
      return json({ id: 'dpl_123', readyState: 'QUEUED', url: 'site.vercel.app' })
    }
    const client = new VercelApiClient('user-installation-token', 'team_123', fetcher)
    const content = Buffer.from('hello')
    await client.uploadFiles([
      {
        content,
        file: 'index.html',
        mode: 0o644,
        sha: vercelFileSha(content),
        size: content.length,
      },
    ])
    await client.createProductionDeployment({
      name: 'site',
      projectId: 'prj_123',
      framework: null,
      rootDirectory: '.',
      installCommand: 'pnpm install --frozen-lockfile',
      buildCommand: 'pnpm build',
      outputDirectory: 'dist',
      files: [
        {
          content,
          file: 'index.html',
          mode: 0o644,
          sha: vercelFileSha(content),
          size: content.length,
        },
      ],
      operationId: 'operation-123',
      sourceRevision: 'abc123',
      sourceBranch: 'main',
    })
    assert.isTrue(requests.every(({ url }) => url.searchParams.get('teamId') === 'team_123'))
    assert.equal(
      new Headers(requests[0]?.init?.headers).get('x-vercel-digest'),
      vercelFileSha(content)
    )
    const deploymentBody = JSON.parse(String(requests[1]?.init?.body))
    assert.equal(deploymentBody.target, 'production')
    assert.equal(deploymentBody.project, 'prj_123')
    assert.equal(deploymentBody.projectSettings.buildCommand, 'pnpm build')
    assert.equal(deploymentBody.projectSettings.outputDirectory, 'dist')
    assert.notProperty(deploymentBody, 'token')
  })

  test('exchanges installation codes with form encoding', async ({ assert }) => {
    let request: { url?: URL; init?: RequestInit } = {}
    const fetcher: typeof fetch = async (input, init) => {
      request = { url: new URL(String(input)), init }
      return json({ access_token: 'installation-token', team_id: 'team_123', user_id: 'user_123' })
    }
    const result = await exchangeVercelInstallationCode(
      {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        code: 'short-code',
        redirectUri: 'https://api.blame.so/api/v1/integrations/vercel/callback',
      },
      fetcher
    )
    assert.equal(request.url?.pathname, '/v2/oauth/access_token')
    assert.equal(
      new Headers(request.init?.headers).get('Content-Type'),
      'application/x-www-form-urlencoded'
    )
    assert.include(String(request.init?.body), 'client_secret=client-secret')
    assert.deepEqual(result, {
      accessToken: 'installation-token',
      teamId: 'team_123',
      userId: 'user_123',
    })
  })
})

function json(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
