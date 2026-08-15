import { createHash } from 'node:crypto'

const endpoints = {
  oauthToken: '/v2/oauth/access_token',
  user: '/v2/user',
  team: (id: string) => `/v2/teams/${encodeURIComponent(id)}`,
  projects: '/v9/projects',
  createProject: '/v11/projects',
  project: (id: string) => `/v9/projects/${encodeURIComponent(id)}`,
  files: '/v2/files',
  deployments: '/v13/deployments',
  deployment: (id: string) => `/v13/deployments/${encodeURIComponent(id)}`,
  cancelDeployment: (id: string) => `/v12/deployments/${encodeURIComponent(id)}/cancel`,
  deploymentEvents: (id: string) => `/v3/deployments/${encodeURIComponent(id)}/events`,
} as const

type Fetcher = typeof fetch

export class VercelApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string
  ) {
    super(message)
    this.name = 'VercelApiError'
  }
}

export type VercelProjectSummary = {
  id: string
  name: string
  framework: string | null
}

export type VercelDeploymentState = {
  id: string
  state: string
  url: string | null
  aliases: string[]
  requestId?: string
}

export type VercelSourceFile = {
  content: Buffer
  file: string
  mode: number
  sha: string
  size: number
}

export class VercelApiClient {
  constructor(
    private readonly token: string,
    private readonly teamId: string | null,
    private readonly fetcher: Fetcher = fetch
  ) {
    if (!token || token.length > 16_384) throw new Error('Vercel access token is invalid')
  }

  async scopeIdentity() {
    if (this.teamId) {
      const value = await this.request<unknown>(endpoints.team(this.teamId))
      const team = record(value)
      return text(team.name) ?? text(team.slug) ?? 'Vercel team'
    }
    const value = await this.request<unknown>(endpoints.user)
    const body = record(value)
    const user = record(body.user ?? body)
    return text(user.name) ?? text(user.username) ?? text(user.email) ?? 'Personal account'
  }

  async projects(cursor?: string) {
    const query = new URLSearchParams({ limit: '100' })
    if (cursor) query.set('until', cursor)
    const value = record(await this.request<unknown>(`${endpoints.projects}?${query}`))
    const projects = Array.isArray(value.projects)
      ? value.projects
          .map(projectSummary)
          .filter((project): project is VercelProjectSummary => Boolean(project))
      : []
    const pagination = record(value.pagination)
    const next = pagination.next
    return {
      projects,
      nextCursor: typeof next === 'number' || typeof next === 'string' ? String(next) : null,
    }
  }

  async project(id: string) {
    return projectSummary(await this.request<unknown>(endpoints.project(id)))
  }

  async projectByName(name: string) {
    try {
      return await this.project(name)
    } catch (error) {
      if (error instanceof VercelApiError && error.status === 404) return null
      throw error
    }
  }

  async createProject(input: {
    name: string
    framework: string | null
    rootDirectory: string
    installCommand?: string
    buildCommand?: string
    outputDirectory?: string
  }) {
    const project = projectSummary(
      await this.request<unknown>(endpoints.createProject, {
        method: 'POST',
        body: {
          name: input.name,
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.rootDirectory !== '.' ? { rootDirectory: input.rootDirectory } : {}),
          ...(input.installCommand ? { installCommand: input.installCommand } : {}),
          ...(input.buildCommand ? { buildCommand: input.buildCommand } : {}),
          ...(input.outputDirectory ? { outputDirectory: input.outputDirectory } : {}),
        },
      })
    )
    if (!project) throw new Error('Vercel returned an invalid project')
    return project
  }

  async uploadFiles(files: VercelSourceFile[], concurrency = 8) {
    let cursor = 0
    const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
      while (cursor < files.length) {
        const file = files[cursor++]!
        await this.request(endpoints.files, {
          method: 'POST',
          body: file.content,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(file.size),
            'x-vercel-digest': file.sha,
          },
        })
      }
    })
    await Promise.all(workers)
  }

  async createProductionDeployment(input: {
    name: string
    projectId: string
    framework: string | null
    rootDirectory: string
    installCommand?: string
    buildCommand?: string
    outputDirectory?: string
    files: VercelSourceFile[]
    operationId: string
    sourceRevision: string
    sourceBranch: string | null
  }) {
    const value = await this.request<unknown>(endpoints.deployments, {
      method: 'POST',
      body: {
        name: input.name,
        project: input.projectId,
        target: 'production',
        files: input.files.map(({ file, mode, sha, size }) => ({ file, mode, sha, size })),
        projectSettings: {
          ...(input.framework ? { framework: input.framework } : {}),
          ...(input.rootDirectory !== '.' ? { rootDirectory: input.rootDirectory } : {}),
          ...(input.installCommand ? { installCommand: input.installCommand } : {}),
          ...(input.buildCommand ? { buildCommand: input.buildCommand } : {}),
          ...(input.outputDirectory ? { outputDirectory: input.outputDirectory } : {}),
        },
        meta: {
          blameOperationId: input.operationId,
          ...(input.sourceRevision !== 'unborn'
            ? { gitCommitSha: input.sourceRevision.slice(0, 128) }
            : {}),
          ...(input.sourceBranch ? { gitCommitRef: input.sourceBranch.slice(0, 255) } : {}),
        },
      },
    })
    return deploymentState(value)
  }

  async deployment(id: string) {
    return deploymentState(await this.request<unknown>(endpoints.deployment(id)))
  }

  async cancelDeployment(id: string) {
    return deploymentState(
      await this.request<unknown>(endpoints.cancelDeployment(id), { method: 'PATCH' })
    )
  }

  async logs(id: string) {
    const value = await this.request<unknown>(
      `${endpoints.deploymentEvents(id)}?direction=backward&limit=100`
    )
    if (!Array.isArray(value)) return []
    return value
      .map((entry) => {
        const event = record(entry)
        const payload = record(event.payload)
        const message = text(payload.text)
        return message ? { created: number(event.created) ?? 0, message: safeLog(message) } : null
      })
      .filter((entry): entry is { created: number; message: string } => Boolean(entry))
  }

  private async request<T>(
    path: string,
    input: {
      method?: string
      body?: unknown
      headers?: Record<string, string>
    } = {}
  ): Promise<T> {
    const url = new URL(path, 'https://api.vercel.com')
    if (this.teamId) url.searchParams.set('teamId', this.teamId)
    const headers = new Headers(input.headers)
    headers.set('Authorization', `Bearer ${this.token}`)
    const rawBody = input.body instanceof Uint8Array
    if (input.body !== undefined && !rawBody) headers.set('Content-Type', 'application/json')
    const response = await this.fetcher(url, {
      method: input.method,
      headers,
      body:
        input.body === undefined
          ? undefined
          : rawBody
            ? Buffer.from(input.body as Uint8Array)
            : JSON.stringify(input.body),
      redirect: 'error',
    })
    const requestId = response.headers.get('x-vercel-id') ?? undefined
    if (!response.ok) throw await vercelError(response, requestId)
    if (response.status === 204) return undefined as T
    const body = await response.text()
    return (body ? JSON.parse(body) : {}) as T
  }
}

export async function exchangeVercelInstallationCode(
  input: {
    clientId: string
    clientSecret: string
    code: string
    redirectUri: string
  },
  fetcher: Fetcher = fetch
) {
  const body = new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    code: input.code,
    redirect_uri: input.redirectUri,
  })
  const response = await fetcher(new URL(endpoints.oauthToken, 'https://api.vercel.com'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'error',
  })
  if (!response.ok) throw await vercelError(response)
  const value = record(await response.json())
  const accessToken = text(value.access_token)
  if (!accessToken || accessToken.length > 16_384) {
    throw new Error('Vercel returned an invalid installation token')
  }
  return {
    accessToken,
    teamId: text(value.team_id) ?? null,
    userId: text(value.user_id) ?? null,
  }
}

export function vercelFileSha(content: Buffer) {
  return createHash('sha1').update(content).digest('hex')
}

async function vercelError(response: Response, requestId?: string) {
  let code: string | undefined
  let message = `Vercel request failed (${response.status})`
  try {
    const body = record(await response.json())
    const error = record(body.error)
    code = text(error.code)
    const providerMessage = text(error.message)
    if (providerMessage) message = providerMessage.slice(0, 500)
  } catch {}
  return new VercelApiError(message, response.status, code, requestId)
}

function projectSummary(value: unknown): VercelProjectSummary | null {
  const project = record(value)
  const id = text(project.id)
  const name = text(project.name)
  if (!id || !name) return null
  return { id, name, framework: text(project.framework) ?? null }
}

function deploymentState(value: unknown): VercelDeploymentState {
  const deployment = record(value)
  const id = text(deployment.id) ?? text(deployment.uid)
  if (!id) throw new Error('Vercel returned an invalid deployment')
  const aliases = [
    ...(Array.isArray(deployment.alias) ? deployment.alias : []),
    ...(Array.isArray(deployment.aliases) ? deployment.aliases : []),
  ].filter((item): item is string => typeof item === 'string')
  return {
    id,
    state: text(deployment.readyState) ?? text(deployment.state) ?? 'UNKNOWN',
    url: normalizedDeploymentUrl(text(deployment.url)),
    aliases: Array.from(new Set(aliases.map(normalizedDeploymentUrl).filter(Boolean))) as string[],
  }
}

function normalizedDeploymentUrl(value: string | undefined) {
  if (!value) return null
  const candidate = value.startsWith('https://') ? value : `https://${value}`
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function safeLog(value: string) {
  return value
    .replace(/(bearer|token|secret|password|authorization)\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .slice(0, 4_000)
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown) {
  return typeof value === 'string' && value.length <= 16_384 ? value : undefined
}

function number(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
