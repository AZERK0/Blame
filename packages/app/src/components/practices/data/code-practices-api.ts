import type {
  CodePractice,
  CodePracticeKey,
  CodePracticeUpdate,
} from "@/components/practices/data/code-practices-data"
import type { ApiConnection } from "@blame/agent-runtime"

export function createCodePracticesApi(connection: ApiConnection) {
  const baseUrl = connection.url.replace(/\/$/, "")

  return {
    async list(projectId: string) {
      return codePracticeList(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/${encodeURIComponent(projectId)}/code-practices`
        )
      )
    },
    async update(
      projectId: string,
      practice: CodePracticeKey,
      input: CodePracticeUpdate
    ) {
      return codePractice(
        await request<unknown>(
          connection,
          baseUrl,
          `/projects/${encodeURIComponent(projectId)}/code-practices/${practice}`,
          {
            body: JSON.stringify(input),
            method: "PATCH",
          }
        )
      )
    },
  }
}

function codePracticeList(value: unknown) {
  if (Array.isArray(value)) return value.map(codePractice)
  if (!isRecord(value)) throw new Error("Unable to read code practices.")
  if ("data" in value) return codePracticeList(value.data)
  throw new Error("Unable to read code practices.")
}

function codePractice(value: unknown) {
  const practice = transformerValue(value)
  if (!isRecord(practice)) throw new Error("Unable to read code practice.")
  if (typeof practice.id !== "string")
    throw new Error("Unable to read code practice.")
  if (typeof practice.projectId !== "string")
    throw new Error("Unable to read code practice.")
  if (typeof practice.practice !== "string")
    throw new Error("Unable to read code practice.")
  const detected = booleanValue(practice.detected)
  const enabled = booleanValue(practice.enabled)
  if (detected === undefined) throw new Error("Unable to read code practice.")
  if (enabled === undefined) throw new Error("Unable to read code practice.")
  if (typeof practice.comment !== "string")
    throw new Error("Unable to read code practice.")
  return { ...practice, detected, enabled } as CodePractice
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

  if (!response.ok) throw new Error(await responseMessage(response))
  if (response.status === 204) return undefined as T
  return unwrapResponse<T>(await response.json())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function booleanValue(value: unknown) {
  if (typeof value === "boolean") return value
  if (value === 1) return true
  if (value === 0) return false
  return undefined
}

function unwrapResponse<T>(value: unknown) {
  if (isRecord(value) && "data" in value) return value.data as T
  return value as T
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json()
    if (typeof body.message === "string") return body.message
  } catch {
    return `Request failed with status ${response.status}`
  }
  return `Request failed with status ${response.status}`
}
