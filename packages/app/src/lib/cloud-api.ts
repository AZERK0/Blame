import type {
  CloudProject,
  CloudSession,
  CloudUser,
  LoginInput,
  SignupInput,
} from "@/context/cloud-auth"
import type { ApiConnection } from "@/context/platform"

type ApiResponse<T> = {
  data: T
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
    async logout() {
      await request<{ message: string }>(connection, baseUrl, "/account/logout", {
        method: "POST",
      })
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
  }
}

function cloudProject(value: unknown) {
  const project = transformerValue(value)
  if (!isRecord(project)) throw new Error("Unable to read project.")
  if (typeof project.id !== "string") throw new Error("Unable to read project.")
  if (typeof project.name !== "string") throw new Error("Unable to read project.")
  return project as CloudProject
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
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authorizationHeader(connection),
      ...init?.headers,
    },
  })

  if (!response.ok) throw new Error(await responseMessage(response))
  if (response.status === 204) return undefined as T
  return (await response.json() as ApiResponse<T>).data
}

function authorizationHeader(connection: ApiConnection) {
  if (!connection.token) return {}
  return { Authorization: `Bearer ${connection.token}` }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
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
