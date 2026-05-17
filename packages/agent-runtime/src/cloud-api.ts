import type {
  ApiConnection,
  BlameProvider,
  ProviderCredentialSummary,
  ProviderListResponse,
  SaveProviderCredentialInput,
} from "./types.js"
import { listClineProviders } from "./provider-catalog.js"

type ApiResponse<T> = {
  data: T
}

type ResolvedCredential = {
  id: number
  providerId: string
  label: string
  apiKey: string
  baseUrl: string | null
}

export async function listProviders(connection: ApiConnection) {
  const [clineProviders, credentials] = await Promise.all([
    listClineProviders(),
    request<ProviderCredentialSummary[]>(connection, "/providers/credentials"),
  ])
  const credentialList = Array.isArray(credentials) ? credentials : []
  const connected: string[] = Array.from(
    new Set(credentialList.map((credential: ProviderCredentialSummary) => credential.providerId))
  )
  return {
    all: clineProviders,
    connected,
    credentials: credentialList,
    default: Object.fromEntries(
      clineProviders.map((provider: BlameProvider) => [
        provider.id,
        provider.defaultModelId ?? Object.keys(provider.models)[0] ?? "",
      ])
    ),
  } satisfies ProviderListResponse
}

export function saveProviderCredential(connection: ApiConnection, input: SaveProviderCredentialInput) {
  return request<ProviderCredentialSummary>(connection, "/providers/credentials", {
    body: JSON.stringify(input),
    method: "POST",
  })
}

export function resolveProviderCredential(
  connection: ApiConnection,
  input: { providerId: string; label?: string }
) {
  return request<ResolvedCredential>(connection, "/providers/credentials/resolve", {
    body: JSON.stringify(input),
    method: "POST",
  })
}

async function request<T>(connection: ApiConnection, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  headers.set("Content-Type", "application/json")
  const authorization = authorizationHeader(connection)
  if (authorization) headers.set("Authorization", authorization)

  const response = await fetch(`${connection.url.replace(/\/$/, "")}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) throw new Error(await responseMessage(response))
  if (response.status === 204) return undefined as T
  return transformerValue((await response.json() as ApiResponse<T>).data) as T
}

function authorizationHeader(connection: ApiConnection) {
  if (!connection.token) return undefined
  return `Bearer ${connection.token}`
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

function transformerValue(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ("data" in value) return transformerValue(value.data)
  if (!Array.isArray(value.transformerData)) return value
  return transformerValue(value.transformerData[0])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}
