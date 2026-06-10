import * as React from "react"
import type {
  AgentEvent,
  AgentUsageSummary,
  ApiConnection,
  ApproveAndMergeInput,
  ApproveAndMergeResult,
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
  SaveProviderCredentialInput,
  SendDevelopmentSessionInput,
  SendSessionInput,
  StartDevelopmentSessionInput,
  StartNewProjectGenerationInput,
  StartSessionInput,
  ReasoningEffort,
} from "@blame/agent-runtime"
import type { NewProjectConfiguration } from "../components/new-project/new-project-options"

type PickerPaths = string | string[] | null

export type OpenDirectoryPickerOptions = {
  title?: string
  multiple?: boolean
}

export type Platform = {
  agent?: AgentClient
  api?: ApiConnection
  previewBrowser?: PreviewBrowserClient
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
    deleteCredential(connection: ApiConnection, id: number): Promise<void>
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
    list(): Promise<unknown>
    messages(sessionId: string): Promise<unknown>
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
  }
  newProjects: {
    generate(input: StartNewProjectGenerationInput): Promise<NewProjectGenerationResult>
  }
  promptOptimizer: {
    optimizeUserStory(
      input: OptimizeUserStoryPromptInput
    ): Promise<OptimizeUserStoryPromptResult>
  }
  approveAndMerge(input: ApproveAndMergeInput): Promise<ApproveAndMergeResult>
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
    | "docker"
    | "docker-compose"
    | "docker-daemon"
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
  gitDiffBetween(input: { from: string; root: string; to: string }): Promise<string>
  listGitDirectory(input: {
    path?: string
    refs: string[]
    root: string
  }): Promise<WorkspaceEntry[]>
  readGitFile(input: { path: string; refs: string[]; root: string }): Promise<string>
  gitRepositoryFingerprint(input: { root: string }): Promise<string | null>
  ensureGitRepository(input: { root: string }): Promise<boolean>
  createProject(input: {
    apiConnection: ApiConnection
    configuration: NewProjectConfiguration
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
    storyId: number
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
