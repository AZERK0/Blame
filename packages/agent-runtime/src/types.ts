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
export type AgentMode = "act" | "plan" | "yolo"

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
  autoApproveWriteTools?: boolean
  autoSendPrompt?: boolean
  mode?: AgentMode
  maxIterations?: number
  prompt: string
  cwd: string
  workspaceRoot: string
  systemPrompt?: string
  credentialLabel?: string
}

export type StartDevelopmentSessionInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  title: string
  summary: string
  cwd: string
  workspaceRoot: string
  codePractices?: ProjectCodePracticePreference[]
}

export type ApproveAndMergeInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  repositoryRoot: string
  worktree: string
  storyBranch: string
  title: string
  summary: string
  codePractices?: ProjectCodePracticePreference[]
}

export type ApproveAndMergeResult = {
  mergeCommit: string
  targetBranch: string
}

export type SendSessionInput = {
  sessionId: string
  prompt: string
}

export type SendDevelopmentSessionInput = {
  sessionId: string
  title: string
  summary: string
}

export type ProjectCodePracticeKey =
  | "coding_style"
  | "unit_tests"
  | "layered_architecture"
  | "commit_message_convention"

export type ProjectCodePracticeResult = {
  practice: ProjectCodePracticeKey
  detected: boolean
  comment: string
}

export type ProjectCodePracticePreference = {
  practice: ProjectCodePracticeKey
  enabled: boolean
}

export type InitializeProjectInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  cwd: string
  workspaceRoot: string
  credentialLabel?: string
  validationFeedback?: {
    validationError: string
    previousResult: string
  }
}

export type InitializeProjectResult = {
  sessionId: string
  setupScript: string
  dockerCompose: string
  practices: ProjectCodePracticeResult[]
}

export type OptimizeUserStoryPromptInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  prompt: string
  cwd: string
  workspaceRoot: string
  reasoningEffort?: ReasoningEffort
  credentialLabel?: string
  title?: string
}

export type OptimizeUserStoryPromptResult = {
  sessionId: string
  markdown: string
}

export type AgentSessionRecord = {
  sessionId: string
  title?: string
  createdAt?: string
  updatedAt?: string
}

export type AgentUsageTotals = {
  cacheReadTokens: number
  cacheWriteTokens: number
  inputTokens: number
  outputTokens: number
  totalCost: number
}

export type AgentUsageSummary = {
  aggregateUsage?: AgentUsageTotals
  usage?: AgentUsageTotals
}

export type AgentEvent = {
  type: "text" | "reasoning" | "tool" | "approval" | "usage" | "notice" | "done" | "error" | "raw"
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
