import * as React from "react"
import type {
  AgentEvent,
  AgentUsageSummary,
  ApiConnection,
  ApproveAndMergeInput,
  ApproveAndMergeResult,
  AssessProjectInitializationImpactInput,
  AssessProjectInitializationImpactResult,
  CompareCheckpointInput,
  CompareCheckpointResult,
  GenerateCommitMessageInput,
  GenerateCommitMessageResult,
  InitializeProjectInput,
  InitializeProjectResult,
  ProjectInitializationDiagnostics,
  LoginOAuthProviderInput,
  NewProjectGenerationResult,
  OptimizeUserStoryPromptInput,
  OptimizeUserStoryPromptResult,
  ProviderListResponse,
  RepairProjectInitializationInput,
  RepairProjectInitializationResult,
  ResolveApprovalInput,
  ResolveMergeConflictsInput,
  ResolveMergeConflictsResult,
  RestoreCheckpointInput,
  RestoreCheckpointResult,
  SaveProviderCredentialInput,
  SendDevelopmentSessionInput,
  SendSessionInput,
  StartDevelopmentSessionInput,
  StartNewProjectGenerationInput,
  StartSessionInput,
  ReasoningEffort,
} from "@blame/agent-runtime"
import type { NewProjectConfiguration } from "../components/new-project/new-project-options"
import type { UserStory } from "../components/backlog/data/backlog-data"

type PickerPaths = string | string[] | null

export type OpenDirectoryPickerOptions = {
  title?: string
  multiple?: boolean
}

export type Platform = {
  agent?: AgentClient
  api?: ApiConnection
  backlogStatusPip?: BacklogStatusPipClient
  platform?: string
  previewBrowser?: PreviewBrowserClient
  systemNotifications?: SystemNotificationsClient
  terminal?: TerminalClient
  updates?: DesktopUpdatesClient
  workspace?: WorkspaceClient
  windowControls?: WindowControlsClient
  openDirectoryPickerDialog?(
    options?: OpenDirectoryPickerOptions
  ): Promise<PickerPaths>
  openExternalLink?(url: string): void
  openPath?(path: string): Promise<string>
}

export type BacklogStatusPipClient = {
  open(): Promise<boolean>
  onRequest(callback: (request: BacklogStatusPipRequest) => void): () => void
  onSnapshot(callback: (snapshot: BacklogStatusPipSnapshot) => void): () => void
  publish(snapshot: BacklogStatusPipSnapshot): void
  request(input: BacklogStatusPipRequest): Promise<boolean>
}

export type BacklogStatusPipSnapshot = {
  authStatus: "loading" | "authenticated" | "unauthenticated"
  hasActiveProject: boolean
  loading: boolean
  stories: UserStory[]
}

export type SystemNotificationInput = {
  body?: string
  title: string
}

export type SystemNotificationsClient = {
  show(input: SystemNotificationInput): Promise<boolean>
}

export type BacklogStatusPipAction =
  | "Send to Dev Agent"
  | "Discard"
  | "Dequeue"
  | "Open Worktree"
  | "Open Preview"
  | "Stop Agent"
  | "Unpause Agent"
  | "View Diff"
  | "View Files"
  | "View Terminal"
  | "Request Changes"
  | "Reject"
  | "Approve & Merge"
  | "Use Context"
  | "Rework"
  | "Delete Permanently"

export type BacklogStatusPipRequest = {
  action?: BacklogStatusPipAction
  drawer?: {
    focusComment?: boolean
    initialDevelopmentTab?: "diff" | "files" | "terminal"
    initialTab?: "user-story" | "development" | "preview"
  }
  rejectChoice?: "request-changes" | "discard"
  stopChoice?: "pause-feedback" | "backlog" | "discard-worktree"
  storyId: string
}

export type WindowControlsClient = {
  close(): void
  isMaximized(): Promise<boolean>
  minimize(): Promise<void>
  onMaximized(callback: (maximized: boolean) => void): () => void
  toggleMaximize(): Promise<void>
}

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported"

export type DesktopUpdateStatus = {
  currentVersion: string
  error?: string
  latestVersion?: string
  phase: DesktopUpdatePhase
  progress?: number
  reason?: string
  releaseDate?: string
  releaseNotes?: string
}

export type DesktopUpdatesClient = {
  check(): Promise<DesktopUpdateStatus>
  download(): Promise<DesktopUpdateStatus>
  getStatus(): Promise<DesktopUpdateStatus>
  install(): Promise<DesktopUpdateStatus>
  onStatus(callback: (status: DesktopUpdateStatus) => void): () => void
}

export type AgentClient = {
  providers: {
    list(connection: ApiConnection): Promise<ProviderListResponse>
    saveCredential(
      connection: ApiConnection,
      input: SaveProviderCredentialInput
    ): Promise<unknown>
    deleteCredential(connection: ApiConnection, id: string): Promise<void>
    loginOAuth(input: LoginOAuthProviderInput): Promise<unknown>
  }
  sessions: {
    start(input: StartSessionInput): Promise<{ sessionId: string }>
    startDevelopment(
      input: StartDevelopmentSessionInput
    ): Promise<{ sessionId: string }>
    send(input: SendSessionInput): Promise<unknown>
    sendDevelopment(input: SendDevelopmentSessionInput): Promise<unknown>
    abort(sessionId: string): Promise<void>
    compareCheckpoint(
      input: CompareCheckpointInput
    ): Promise<CompareCheckpointResult>
    list(): Promise<unknown>
    messages(sessionId: string): Promise<unknown>
    restoreCheckpoint(
      input: RestoreCheckpointInput
    ): Promise<RestoreCheckpointResult>
    usage(sessionId: string): Promise<AgentUsageSummary | undefined>
    eventStreamUrl?(sessionId: string): Promise<string | null>
    onEvent(
      sessionId: string,
      callback: (event: AgentEvent) => void
    ): () => void
  }
  approvals: {
    resolve(input: ResolveApprovalInput): Promise<boolean>
    onRequest(callback: (event: AgentEvent) => void): () => void
  }
  initializations: {
    run(input: InitializeProjectInput): Promise<InitializeProjectResult>
    repair(
      input: RepairProjectInitializationInput
    ): Promise<RepairProjectInitializationResult>
    assessImpact(
      input: AssessProjectInitializationImpactInput
    ): Promise<AssessProjectInitializationImpactResult>
  }
  newProjects: {
    generate(
      input: StartNewProjectGenerationInput
    ): Promise<NewProjectGenerationResult>
  }
  promptOptimizer: {
    optimizeUserStory(
      input: OptimizeUserStoryPromptInput
    ): Promise<OptimizeUserStoryPromptResult>
  }
  approveAndMerge(input: ApproveAndMergeInput): Promise<ApproveAndMergeResult>
  generateCommitMessage(
    input: GenerateCommitMessageInput
  ): Promise<GenerateCommitMessageResult>
  resolveMergeConflicts(
    input: ResolveMergeConflictsInput
  ): Promise<ResolveMergeConflictsResult>
}

export type WorkspaceEntry = {
  name: string
  path: string
  type: "directory" | "file"
}

export type WorktreeResult = {
  worktree: string
  branch: string
}

export type GitBranchStatus = {
  ahead: number
  behind: number
  current: string
  detached: boolean
  upstream?: string
}

export type GitStatusFile = {
  conflicted?: boolean
  indexStatus: string
  originalPath?: string
  path: string
  staged: boolean
  status: string
  untracked: boolean
  unstaged: boolean
  worktreeStatus: string
}

export type GitStatusResult = {
  branch: GitBranchStatus
  files: GitStatusFile[]
}

export type GitLogCommitRef = {
  name: string
  type: "branch" | "head" | "remote" | "tag" | "other"
}

export type GitLogCommit = {
  authorEmail: string
  authorName: string
  date: string
  hash: string
  message: string
  parents: string[]
  refs: GitLogCommitRef[]
}

export type GitCommandResult = {
  output: string
}

export type GitConflictFile = {
  base: string
  current: string
  incoming: string
  path: string
  result: string
}

export type ProjectSetupEvent = {
  runId: string
  type: "stdout" | "stderr" | "exit"
  data: string
}

export type ProjectCreationEvent = {
  type: "stdout" | "stderr" | "exit"
  data: string
}

export type ProjectServiceLogEvent = {
  streamId: string
  type: "stdout" | "stderr" | "exit"
  data: string
}

export type HostDependencyIssue = {
  action: string
  message: string
  name:
    | "git"
    | "blame-runtime"
    | "cline-sdk"
    | "containerd"
    | "nerdctl"
    | "nerdctl-compose"
    | "node"
    | "corepack"
    | "npm"
    | "pnpm"
    | "yarn"
    | "bun"
    | "pip"
  status: "missing" | "unavailable" | "unsupported"
}

export type HostDependencyReport = {
  issues: HostDependencyIssue[]
  ok: boolean
}

export type PreviewBrowserBounds = {
  height: number
  width: number
  x: number
  y: number
}

export type PreviewBrowserState = {
  error?: string
  id: string
  loading: boolean
  url?: string
}

export type PreviewBrowserClient = {
  capture(input: {
    id: string
    size?: "full" | "thumbnail"
  }): Promise<string | null>
  create(): Promise<{ id: string }>
  destroy(input: { id: string }): Promise<boolean>
  load(input: { id: string; url: string }): Promise<boolean>
  onState(
    input: { id: string },
    callback: (state: PreviewBrowserState) => void
  ): () => void
  reload(input: { id: string }): Promise<boolean>
  setBounds(input: {
    bounds: PreviewBrowserBounds
    id: string
    visible: boolean
  }): Promise<boolean>
}

export type WorkspaceClient = {
  pathExists(input: { path: string }): Promise<boolean>
  optimizeAttachmentForAiContext(input: {
    content: string
    name: string
    type: string
  }): Promise<{ markdown: string }>
  listDirectory(input: {
    root: string
    path?: string
  }): Promise<WorkspaceEntry[]>
  readFile(input: { root: string; path: string }): Promise<string>
  searchFiles(input: {
    root: string
    query: string
    limit?: number
  }): Promise<WorkspaceEntry[]>
  gitDiff(input: { root: string }): Promise<string>
  gitDiffBetween(input: {
    from: string
    root: string
    to: string
  }): Promise<string>
  gitStatus(input: { root: string }): Promise<GitStatusResult>
  gitCommitCount?(input: { root: string }): Promise<number>
  gitLog(input: {
    root: string
    limit?: number
    skip?: number
  }): Promise<GitLogCommit[]>
  gitFileDiff(input: {
    root: string
    path: string
    staged?: boolean
  }): Promise<string>
  gitCommitDiff(input: { root: string; hash: string }): Promise<string>
  gitConflictFile(input: {
    root: string
    path: string
  }): Promise<GitConflictFile>
  gitAcceptConflictFile(input: {
    root: string
    path: string
    side: "current" | "incoming"
  }): Promise<boolean>
  gitResolveConflictFile(input: {
    root: string
    path: string
    content?: string
  }): Promise<boolean>
  gitAbortConflict(input: { root: string }): Promise<GitCommandResult>
  gitContinueConflict(input: { root: string }): Promise<GitCommandResult>
  gitStageFiles(input: { root: string; paths: string[] }): Promise<boolean>
  gitUnstageFiles(input: { root: string; paths: string[] }): Promise<boolean>
  gitRollbackFiles(input: { root: string; paths: string[] }): Promise<boolean>
  gitDeleteFiles(input: { root: string; paths: string[] }): Promise<boolean>
  gitCommit(input: { root: string; message: string }): Promise<GitCommandResult>
  gitPush(input: { root: string }): Promise<GitCommandResult>
  listGitDirectory(input: {
    path?: string
    refs: string[]
    root: string
  }): Promise<WorkspaceEntry[]>
  readGitFile(input: {
    path: string
    refs: string[]
    root: string
  }): Promise<string>
  gitRepositoryFingerprint(input: { root: string }): Promise<string | null>
  ensureGitRepository(input: { root: string }): Promise<boolean>
  createProject(input: {
    apiConnection: ApiConnection
    configuration: NewProjectConfiguration
    credentialLabel?: string
    modelId: string
    parentPath: string
    projectName: string
    providerId: string
    reasoningEffort?: ReasoningEffort
    runId: string
  }): Promise<{
    path: string
  }>
  createWorktree(input: {
    repositoryRoot: string
    storyId: string
    title: string
  }): Promise<WorktreeResult>
  checkHostDependencies(input: {
    setupScript: string
    worktree?: string
  }): Promise<HostDependencyReport>
  runProjectSetup(input: {
    worktree: string
    setupScript: string
    dockerCompose: string
    hostDependenciesChecked?: boolean
  }): Promise<{ runId: string }>
  collectProjectInitializationDiagnostics(input: {
    worktree: string
    launchError: string
  }): Promise<ProjectInitializationDiagnostics>
  stopProjectSetup(input: { worktree: string }): Promise<boolean>
  removeWorktree(input: {
    repositoryRoot: string
    worktree: string
  }): Promise<boolean>
  resolveProjectPreviewUrl(input: { worktree: string }): Promise<string | null>
  ensureProjectPreviewUrl(input: { worktree: string }): Promise<string | null>
  projectRuntimeHealthy?(input: { worktree: string }): Promise<boolean>
  ensureRuntimeReady?(): Promise<unknown>
  repairRuntime?(): Promise<unknown>
  resetRuntime?(): Promise<unknown>
  listProjectServices?(input: { worktree: string }): Promise<string[]>
  startProjectServiceLogs?(input: {
    service: string
    worktree: string
  }): Promise<{ streamId: string }>
  stopProjectServiceLogs?(input: { streamId: string }): Promise<boolean>
  onProjectServiceLog?(
    streamId: string,
    callback: (event: ProjectServiceLogEvent) => void
  ): () => void
  onSetupEvent(
    runId: string,
    callback: (event: ProjectSetupEvent) => void
  ): () => void
  onProjectCreationEvent?(
    runId: string,
    callback: (event: ProjectCreationEvent) => void
  ): () => void
}

export type TerminalEvent = {
  id: string
  type: "stdout" | "stderr" | "exit"
  data: string
}

export type TerminalClient = {
  start(input: { cwd: string }): Promise<{ id: string; cwd: string }>
  write(input: { id: string; data: string }): Promise<boolean>
  stop(id: string): Promise<boolean>
  onEvent(id: string, callback: (event: TerminalEvent) => void): () => void
}

export const PlatformContext = React.createContext<Platform>({})

export function usePlatform() {
  return React.useContext(PlatformContext)
}

export function createWebPlatform(): Platform {
  return {
    async openDirectoryPickerDialog(options) {
      const value = window.prompt(options?.title ?? "Open Project")
      return value?.trim() || null
    },
    openExternalLink(url) {
      window.open(url, "_blank", "noopener,noreferrer")
    },
  }
}
