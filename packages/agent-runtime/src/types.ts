export type ApiConnection = {
  url: string
  token?: string | null
}

export type BlameModel = {
  id: string
  name: string
  status?: string
  description?: string
  contextWindow?: number
  maxTokens?: number
  capabilities?: string[]
  cost: {
    input: number
    output: number
  }
  variants?: Record<string, unknown>
}

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh"

export type BlameProvider = {
  id: string
  name: string
  description?: string
  baseUrl?: string
  defaultModelId?: string
  capabilities?: string[]
  models: Record<string, BlameModel>
}

export type ProviderCredentialSummary = {
  id: number
  userId: number
  providerId: string
  label: string
  authMethod?: "api-key" | "oauth"
  baseUrl: string | null
  accountId?: string | null
  expiresAt?: string | null
  createdAt: string
  updatedAt: string | null
}

export type ProviderListResponse = {
  all: BlameProvider[]
  connected: string[]
  default: Record<string, string>
  credentials: ProviderCredentialSummary[]
}

export type SaveProviderCredentialInput = {
  providerId: string
  label?: string
  apiKey: string
  baseUrl?: string | null
}

export type DeleteProviderCredentialInput = {
  id: number
}

export type OAuthCredentials = {
  access: string
  refresh: string
  expires: number
  accountId?: string
  email?: string
  metadata?: Record<string, unknown>
}

export type SaveOAuthCredentialInput = {
  providerId: string
  label?: string
  apiKey: string
  oauthCredentials: OAuthCredentials
  baseUrl?: string | null
}

export type LoginOAuthProviderInput = {
  apiConnection: ApiConnection
  providerId: string
  label?: string
  baseUrl?: string | null
}

export type StartSessionInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  prompt: string
  cwd: string
  workspaceRoot: string
  systemPrompt?: string
  credentialLabel?: string
}

export type SendSessionInput = {
  sessionId: string
  prompt: string
}

export type AgentSessionRecord = {
  sessionId: string
  title?: string
  createdAt?: string
  updatedAt?: string
}

export type AgentEvent = {
  type: "text" | "tool" | "approval" | "usage" | "notice" | "done" | "error" | "raw"
  sessionId?: string
  payload: unknown
}

export type AgentRuntimeEvents = {
  emit(event: AgentEvent): void
}

export type ApprovalDecision = "approve" | "deny" | "always"

export type AgentApprovalRequest = {
  id: string
  sessionId?: string
  toolName: string
  reason?: string
  input?: unknown
}

export type ResolveApprovalInput = {
  requestId: string
  decision: ApprovalDecision
}
