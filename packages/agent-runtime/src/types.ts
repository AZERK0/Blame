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
export type AgentBackendMode = "auto" | "local" | "hub" | "remote"

export type AgentBackendConfig = {
  authToken?: string
  cwd?: string
  endpoint?: string
  key?: string
  mode: AgentBackendMode
  workspaceRoot?: string
}

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
  modelIds?: string[]
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
  modelIds?: string[]
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
  userImages?: string[]
  userFiles?: string[]
  cwd: string
  workspaceRoot: string
  systemPrompt?: string
  credentialLabel?: string
  backend?: AgentBackendConfig
}

export type CodeSelectionAttachment = {
  id?: string
  content: string
  endLine: number
  path: string
  startLine: number
}

export type FileAttachment = {
  id?: string
  content: string
  name: string
  size: number
  type: string
}

export type StartDevelopmentSessionInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  credentialLabel?: string
  reasoningEffort?: ReasoningEffort
  autoSendPrompt?: boolean
  maxIterations?: number
  title: string
  summary: string
  codeSelectionAttachments?: CodeSelectionAttachment[]
  fileAttachments?: FileAttachment[]
  feedback?: string
  feedbackCodeSelectionAttachments?: CodeSelectionAttachment[]
  feedbackFileAttachments?: FileAttachment[]
  cwd: string
  workspaceRoot: string
  codePractices?: ProjectCodePracticePreference[]
  backend?: AgentBackendConfig
}

export type ApproveAndMergeInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  credentialLabel?: string
  reasoningEffort?: ReasoningEffort
  repositoryRoot: string
  worktree: string
  storyBranch: string
  title: string
  summary: string
  codePractices?: ProjectCodePracticePreference[]
  backend?: AgentBackendConfig
}

export type ApproveAndMergeResult = {
  baseCommit: string
  mergeCommit: string
  targetBranch: string
}

export type SendSessionInput = {
  sessionId: string
  prompt: string
  userImages?: string[]
  userFiles?: string[]
}

export type SendDevelopmentSessionInput = {
  sessionId: string
  title: string
  summary: string
  codeSelectionAttachments?: CodeSelectionAttachment[]
  fileAttachments?: FileAttachment[]
  feedback?: string
  feedbackCodeSelectionAttachments?: CodeSelectionAttachment[]
  feedbackFileAttachments?: FileAttachment[]
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

export type ProjectRunConfiguration = {
  id: string
  name: string
  command: string
  cwd: string
  default: boolean
}

export type PreviewManifestConfidence = "low" | "medium" | "high"

export type PreviewManifestEnvironment = Record<string, string>

export type PreviewManifestProject = {
  root?: string
  detectedStack?: string[]
  confidence?: PreviewManifestConfidence
}

export type PreviewManifestSetupTask = {
  id: string
  image: string
  workingDir?: string
  command: string
  runAs?: "host" | "root"
  environment?: PreviewManifestEnvironment
  dependsOn?: string[]
}

export type PreviewManifestServiceKind = "preview" | "dependency" | "worker"

export type PreviewManifestPreview = {
  internalPort: number
  protocol: "http"
  path: string
}

export type PreviewManifestHealthcheck = {
  type: "http"
  path: string
  timeoutMs: number
}

export type PreviewManifestService = {
  id: string
  kind: PreviewManifestServiceKind
  image: string
  workingDir?: string
  command?: string
  environment?: PreviewManifestEnvironment
  dependsOn?: string[]
  preview?: PreviewManifestPreview
  healthcheck?: PreviewManifestHealthcheck
}

export type PreviewManifestCache = {
  name: string
  target: string
}

export type PreviewManifestRisk = {
  level: "low" | "medium" | "high"
  message: string
}

export type PreviewManifest = {
  version: 1
  confidence: PreviewManifestConfidence
  project: PreviewManifestProject
  setup: PreviewManifestSetupTask[]
  services: PreviewManifestService[]
  caches: PreviewManifestCache[]
  risks: PreviewManifestRisk[]
}

export type ProjectInitializationDatabaseMode = "existing" | "compose"

export type ProjectInitializationPreferences = {
  database?: {
    mode: ProjectInitializationDatabaseMode
  }
}

export type InitializeProjectInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  cwd: string
  workspaceRoot: string
  credentialLabel?: string
  preferences?: ProjectInitializationPreferences
  validationFeedback?: {
    validationError: string
    previousResult: string
  }
  backend?: AgentBackendConfig
}

export type InitializeProjectResult = {
  sessionId: string
  previewManifest?: PreviewManifest
  setupScript: string
  dockerCompose: string
  runConfigurations: ProjectRunConfiguration[]
  practices: ProjectCodePracticeResult[]
}

export type ProjectInitializationRepairClassification =
  | "repairable_initialization"
  | "project_code_failure"
  | "external_failure"
  | "unknown"

export type ProjectInitializationDiagnostics = {
  setupLog: string
  launchError: string
  composeConfig: string
  composePs: string
  serviceLogs: Record<string, string>
}

export type ProjectInitializationImpactClassification =
  | "initialization_update_required"
  | "initialization_still_valid"
  | "project_code_failure"
  | "unknown"

export type ProjectInitializationImpactDiagnostics = {
  baseCommit: string
  mergeCommit: string
  changedFiles: string[]
  diffSummary: string
  relevantDiffs: Record<string, string>
  currentPreviewManifest?: PreviewManifest
  currentSetupScript: string
  currentDockerCompose: string
  currentRunConfigurations: ProjectRunConfiguration[]
  strategicFilesBefore: Record<string, string>
  strategicFilesAfter: Record<string, string>
}

export type AssessProjectInitializationImpactInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  cwd: string
  workspaceRoot: string
  credentialLabel?: string
  baseCommit: string
  mergeCommit: string
  previewManifest?: PreviewManifest
  setupScript: string
  dockerCompose: string
  runConfigurations: ProjectRunConfiguration[]
  backend?: AgentBackendConfig
}

export type AssessProjectInitializationImpactResult = {
  sessionId?: string
  classification: ProjectInitializationImpactClassification
  reason: string
  repairInstruction?: string
  diagnostics?: ProjectInitializationImpactDiagnostics
}

export type RepairProjectInitializationInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  cwd: string
  workspaceRoot: string
  credentialLabel?: string
  previewManifest?: PreviewManifest
  setupScript: string
  dockerCompose: string
  runConfigurations: ProjectRunConfiguration[]
  diagnostics:
    | ProjectInitializationDiagnostics
    | ProjectInitializationImpactDiagnostics
  backend?: AgentBackendConfig
}

export type RepairProjectInitializationResult = {
  sessionId: string
  classification: ProjectInitializationRepairClassification
  reason: string
  previewManifest?: PreviewManifest
  setupScript?: string
  dockerCompose?: string
  runConfigurations?: ProjectRunConfiguration[]
}

export type NewProjectGenerationConfiguration = {
  platform: string
  frontend: string
  styling: string
  uiLibrary: string
  backend: string
  database: string
  orm: string
  packageManager: string
  codeQuality: string
  advancedOptions: string[]
}

export type StartNewProjectGenerationInput = {
  apiConnection: ApiConnection
  providerId: string
  modelId: string
  reasoningEffort?: ReasoningEffort
  credentialLabel?: string
  configuration: NewProjectGenerationConfiguration
  cwd: string
  workspaceRoot: string
  projectName: string
  sessionId?: string
  backend?: AgentBackendConfig
}

export type NewProjectGenerationResult = {
  path: string
  sessionId: string
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
  backend?: AgentBackendConfig
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
  cacheReadTokens?: number
  cacheWriteTokens?: number
  cost?: number
  inputTokens: number
  outputTokens: number
  totalCacheReadTokens?: number
  totalCacheWriteTokens?: number
  totalCost?: number
  totalInputTokens: number
  totalOutputTokens: number
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

export type CodeGraphStatusState =
  | "missing"
  | "building"
  | "ready"
  | "stale"
  | "error"

export type CodeGraphStatus = {
  available: boolean
  branch?: string
  builtCommit?: string
  command?: string
  contextSavings?: Record<string, unknown>
  edges?: number
  files?: number
  languages?: string[]
  lastUpdated?: string
  message?: string
  nodes?: number
  recommendation?: string
  staleReason?: string
  state: CodeGraphStatusState
  version?: string
  worktree: string
}

export type CodeGraphUpdateInput = {
  force?: boolean
  signal?: AbortSignal
  waitMs?: number
  worktree: string
}

export type CodeGraphUpdateResult = CodeGraphStatus & {
  action: "building" | "failed" | "skipped" | "unavailable" | "updated"
  durationMs?: number
  output?: string
}

export type CodeGraphQueryInput = {
  base?: string
  changedFiles?: string[]
  signal?: AbortSignal
  waitMs?: number
  worktree: string
}

export type CodeGraphImpactRadiusInput = CodeGraphQueryInput & {
  maxDepth?: number
}

export type CodeGraphReviewContextInput = CodeGraphImpactRadiusInput & {
  includeSource?: boolean
  maxLinesPerFile?: number
}

export type CodeGraphArchitectureOverviewInput = CodeGraphQueryInput & {
  detailLevel?: "minimal" | "standard"
}

export type CodeGraphQueryResult = CodeGraphStatus & {
  data?: unknown
  source?: "cli" | "mcp"
}

export type CodeReviewGraphProvider = {
  architectureOverview(
    input: CodeGraphArchitectureOverviewInput,
  ): Promise<CodeGraphQueryResult>
  impactRadius(input: CodeGraphImpactRadiusInput): Promise<CodeGraphQueryResult>
  reviewContext(
    input: CodeGraphReviewContextInput,
  ): Promise<CodeGraphQueryResult>
  status(input: {
    signal?: AbortSignal
    waitMs?: number
    worktree: string
  }): Promise<CodeGraphStatus>
  update(input: CodeGraphUpdateInput): Promise<CodeGraphUpdateResult>
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
