import type {
  CloudProject,
  CloudProjectInitializationSnapshot,
  CloudSession,
  CloudUser,
  LoginInput,
  SignupInput,
} from "@/context/cloud-auth"
import type { ApiConnection } from "@blame/agent-runtime"

export class CloudApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = "CloudApiError"
  }
}

export function createCloudApi(connection: ApiConnection) {
  const baseUrl = connection.url.replace(/\/$/, "")

  return {
    login(input: LoginInput) {
      return request<CloudSession>(connection, baseUrl, "/auth/login", {
        body: JSON.stringify(input),
        method: "POST",
      })
    },
    signup(input: SignupInput) {
      return request<CloudSession>(connection, baseUrl, "/auth/signup", {
        body: JSON.stringify(input),
        method: "POST",
      })
    },
    profile() {
      return request<CloudUser>(connection, baseUrl, "/account/profile")
    },
    projects() {
      return request<unknown>(connection, baseUrl, "/projects").then(
        cloudProjects
      )
    },
    async logout() {
      await request<{ message: string }>(
        connection,
        baseUrl,
        "/account/logout",
        {
          method: "POST",
        }
      )
    },
    ensureProject(input: {
      name: string
      repositoryFingerprint?: string | null
    }) {
      return request<unknown>(connection, baseUrl, "/projects", {
        body: JSON.stringify(input),
        method: "POST",
      }).then(cloudProject)
    },
    projectInitialization(projectId: string) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization`
      ).then(cloudProjectInitializationSnapshot)
    },
    startProjectInitialization(
      projectId: string,
      input: {
        providerId: string
        modelId: string
        clineSessionId?: string | null
      }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/start`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
    completeProjectInitialization(
      projectId: string,
      input: {
        clineSessionId?: string | null
        setupScript: string
        dockerCompose: string
        practices: Array<{
          practice: string
          detected: boolean
          comment: string
        }>
      }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/complete`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
    failProjectInitialization(
      projectId: string,
      input: { clineSessionId?: string | null; error: string }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/fail`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
    repairProjectInitialization(
      projectId: string,
      input: {
        clineSessionId?: string | null
        setupScript: string
        dockerCompose: string
        reason: string
      }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/repair`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
  }
}

function cloudProjects(value: unknown) {
  const projects = transformerValue(value)
  if (!Array.isArray(projects)) throw new Error("Unable to read projects.")
  return projects.map(cloudProject)
}

function cloudProject(value: unknown) {
  const project = transformerValue(value)
  if (!isRecord(project)) throw new Error("Unable to read project.")
  if (typeof project.id !== "string") throw new Error("Unable to read project.")
  if (typeof project.name !== "string")
    throw new Error("Unable to read project.")
  return project as CloudProject
}

function cloudProjectInitializationSnapshot(value: unknown) {
  const snapshot = transformerValue(value)
  if (!isRecord(snapshot))
    throw new Error("Unable to read project initialization.")
  if (!("practices" in snapshot) || !Array.isArray(snapshot.practices)) {
    throw new Error("Unable to read project initialization.")
  }
  if (
    "initialization" in snapshot &&
    snapshot.initialization !== null &&
    !isRecord(snapshot.initialization)
  ) {
    throw new Error("Unable to read project initialization.")
  }
  return snapshot as CloudProjectInitializationSnapshot
}

function transformerValue(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ("data" in value) return transformerValue(value.data)
  if (!Array.isArray(value.transformerData)) return value
  return transformerValue(value.transformerData[0])
}

async function request<T>(
  connection: ApiConnection,
  baseUrl: string,
  path: string,
  init?: RequestInit
) {
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  headers.set("Content-Type", "application/json")
  if (connection.token)
    headers.set("Authorization", `Bearer ${connection.token}`)

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    throw new CloudApiError(await responseMessage(response), response.status)
  }
  if (response.status === 204) return undefined as T
  return responseData(await response.json()) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function responseData(value: unknown) {
  if (!isRecord(value) || !("data" in value)) return value
  return value.data
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json()
    if (typeof body.message === "string") return body.message
    if (typeof body.error === "string") return body.error
  } catch {
    return `Request failed with status ${response.status}`
  }
  return `Request failed with status ${response.status}`
}
