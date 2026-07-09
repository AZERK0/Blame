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
  GenerateUserStoryTitleInput,
  GenerateUserStoryTitleResult,
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
} from "@blame/agent-runtime";
import type {
  BacklogStatusPipRequest,
  BacklogStatusPipSnapshot,
  GitCommandResult,
  GitLogCommit,
  GitStatusResult,
} from "@blame/app";
import type { HostDependencyReport } from "../main/host-dependencies";
import type { CreateProjectInput } from "../main/project-creation";

export type OpenDirectoryPickerOptions = {
  title?: string;
  multiple?: boolean;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  type: "directory" | "file";
};

export type WorktreeResult = {
  worktree: string;
  branch: string;
};

export type ProjectSetupEvent = {
  runId: string;
  type: "stdout" | "stderr" | "exit";
  data: string;
};

export type GitConflictFile = {
  base: string;
  current: string;
  incoming: string;
  path: string;
  result: string;
};

export type ProjectCreationEvent = {
  type: "stdout" | "stderr" | "exit";
  data: string;
};

export type ProjectServiceLogEvent = {
  streamId: string;
  type: "stdout" | "stderr" | "exit";
  data: string;
};

export type TerminalEvent = {
  id: string;
  type: "stdout" | "stderr" | "exit";
  data: string;
};

export type PreviewBrowserBounds = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type PreviewBrowserState = {
  error?: string;
  id: string;
  loading: boolean;
  url?: string;
};

export type WindowControls = {
  close(): void;
  isMaximized(): Promise<boolean>;
  minimize(): Promise<void>;
  onMaximized(callback: (maximized: boolean) => void): () => void;
  setPresentation(input: WindowPresentationInput): Promise<boolean>;
  toggleMaximize(): Promise<void>;
};

export type WindowPresentationInput = {
  mode: "app" | "connect" | "welcome";
};

export type DesktopUpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error"
  | "unsupported";

export type DesktopUpdateStatus = {
  currentVersion: string;
  error?: string;
  latestVersion?: string;
  phase: DesktopUpdatePhase;
  progress?: number;
  reason?: string;
  releaseDate?: string;
  releaseNotes?: string;
};

export type DesktopUpdates = {
  check(): Promise<DesktopUpdateStatus>;
  download(): Promise<DesktopUpdateStatus>;
  getStatus(): Promise<DesktopUpdateStatus>;
  install(): Promise<DesktopUpdateStatus>;
  onStatus(callback: (status: DesktopUpdateStatus) => void): () => void;
};

export type SystemNotificationInput = {
  body?: string;
  title: string;
};

export type SystemNotifications = {
  show(input: SystemNotificationInput): Promise<boolean>;
};

export type BacklogStatusPip = {
  onRequest(callback: (request: BacklogStatusPipRequest) => void): () => void;
  onSnapshot(
    callback: (snapshot: BacklogStatusPipSnapshot) => void,
  ): () => void;
  open(): Promise<boolean>;
  publish(snapshot: BacklogStatusPipSnapshot): void;
  request(input: BacklogStatusPipRequest): Promise<boolean>;
};

export type BlameDesktopApi = {
  openDirectoryPicker(
    options?: OpenDirectoryPickerOptions,
  ): Promise<string | string[] | null>;
  openExternalLink(url: string): void;
  openPath(path: string): Promise<string>;
  backlogStatusPip: BacklogStatusPip;
  platform: NodeJS.Platform;
  systemNotifications: SystemNotifications;
  updates: DesktopUpdates;
  windowControls: WindowControls;
  previewBrowser: {
    capture(input: {
      id: string;
      size?: "full" | "thumbnail";
    }): Promise<string | null>;
    create(): Promise<{ id: string }>;
    destroy(input: { id: string }): Promise<boolean>;
    load(input: { id: string; url: string }): Promise<boolean>;
    onState(
      input: { id: string },
      callback: (state: PreviewBrowserState) => void,
    ): () => void;
    reload(input: { id: string }): Promise<boolean>;
    setDevtoolsScope(input: {
      id: string;
      scope?: string | null;
    }): Promise<boolean>;
    setBounds(input: {
      bounds: PreviewBrowserBounds;
      id: string;
      visible: boolean;
    }): Promise<boolean>;
  };
  workspace: {
    pathExists(input: { path: string }): Promise<boolean>;
    optimizeAttachmentForAiContext(input: {
      content: string;
      name: string;
      type: string;
    }): Promise<{ markdown: string }>;
    listDirectory(input: {
      root: string;
      path?: string;
    }): Promise<WorkspaceEntry[]>;
    readFile(input: { root: string; path: string }): Promise<string>;
    searchFiles(input: {
      root: string;
      query: string;
      limit?: number;
    }): Promise<WorkspaceEntry[]>;
    gitDiff(input: { root: string }): Promise<string>;
    gitDiffBetween(input: {
      from: string;
      root: string;
      to: string;
    }): Promise<string>;
    gitStatus(input: { root: string }): Promise<GitStatusResult>;
    gitCommitCount(input: { root: string }): Promise<number>;
    gitLog(input: {
      root: string;
      limit?: number;
      skip?: number;
    }): Promise<GitLogCommit[]>;
    gitFileDiff(input: {
      root: string;
      path: string;
      staged?: boolean;
    }): Promise<string>;
    gitCommitDiff(input: { root: string; hash: string }): Promise<string>;
    gitConflictFile(input: {
      root: string;
      path: string;
    }): Promise<GitConflictFile>;
    gitAcceptConflictFile(input: {
      root: string;
      path: string;
      side: "current" | "incoming";
    }): Promise<boolean>;
    gitResolveConflictFile(input: {
      root: string;
      path: string;
      content?: string;
    }): Promise<boolean>;
    gitAbortConflict(input: { root: string }): Promise<GitCommandResult>;
    gitContinueConflict(input: { root: string }): Promise<GitCommandResult>;
    gitStageFiles(input: { root: string; paths: string[] }): Promise<boolean>;
    gitUnstageFiles(input: { root: string; paths: string[] }): Promise<boolean>;
    gitRollbackFiles(input: {
      root: string;
      paths: string[];
    }): Promise<boolean>;
    gitDeleteFiles(input: { root: string; paths: string[] }): Promise<boolean>;
    gitCommit(input: {
      root: string;
      message: string;
    }): Promise<GitCommandResult>;
    gitPush(input: { root: string }): Promise<GitCommandResult>;
    listGitDirectory(input: {
      path?: string;
      refs: string[];
      root: string;
    }): Promise<WorkspaceEntry[]>;
    readGitFile(input: {
      path: string;
      refs: string[];
      root: string;
    }): Promise<string>;
    gitRepositoryFingerprint(input: { root: string }): Promise<string | null>;
    ensureGitRepository(input: { root: string }): Promise<boolean>;
    createProject(input: CreateProjectInput): Promise<{
      path: string;
    }>;
    createWorktree(input: {
      repositoryRoot: string;
      storyId: string;
      title: string;
    }): Promise<WorktreeResult>;
    checkHostDependencies(input: {
      setupScript: string;
      worktree?: string;
    }): Promise<HostDependencyReport>;
    runProjectSetup(input: {
      worktree: string;
      setupScript: string;
      dockerCompose: string;
      hostDependenciesChecked?: boolean;
    }): Promise<{ runId: string }>;
    collectProjectInitializationDiagnostics(input: {
      worktree: string;
      launchError: string;
    }): Promise<ProjectInitializationDiagnostics>;
    stopProjectSetup(input: { worktree: string }): Promise<boolean>;
    removeWorktree(input: {
      repositoryRoot: string;
      worktree: string;
    }): Promise<boolean>;
    resolveProjectPreviewUrl(input: {
      worktree: string;
    }): Promise<string | null>;
    ensureProjectPreviewUrl(input: {
      worktree: string;
    }): Promise<string | null>;
    ensureRuntimeReady(): Promise<HostDependencyReport>;
    repairRuntime(): Promise<HostDependencyReport>;
    resetRuntime(): Promise<HostDependencyReport>;
    projectRuntimeHealthy(input: { worktree: string }): Promise<boolean>;
    listProjectServices(input: { worktree: string }): Promise<string[]>;
    startProjectServiceLogs(input: {
      service: string;
      worktree: string;
    }): Promise<{ streamId: string }>;
    stopProjectServiceLogs(input: { streamId: string }): Promise<boolean>;
    onProjectServiceLog(
      streamId: string,
      callback: (event: ProjectServiceLogEvent) => void,
    ): () => void;
    onSetupEvent(
      runId: string,
      callback: (event: ProjectSetupEvent) => void,
    ): () => void;
    onProjectCreationEvent(
      runId: string,
      callback: (event: ProjectCreationEvent) => void,
    ): () => void;
  };
  terminal: {
    start(input: { cwd: string }): Promise<{ id: string; cwd: string }>;
    write(input: { id: string; data: string }): Promise<boolean>;
    stop(id: string): Promise<boolean>;
    onEvent(id: string, callback: (event: TerminalEvent) => void): () => void;
  };
  agent: {
    providers: {
      list(connection: ApiConnection): Promise<ProviderListResponse>;
      saveCredential(
        connection: ApiConnection,
        input: SaveProviderCredentialInput,
      ): Promise<unknown>;
      deleteCredential(connection: ApiConnection, id: string): Promise<void>;
      loginOAuth(input: LoginOAuthProviderInput): Promise<unknown>;
    };
    sessions: {
      start(input: StartSessionInput): Promise<{ sessionId: string }>;
      startDevelopment(
        input: StartDevelopmentSessionInput,
      ): Promise<{ sessionId: string }>;
      send(input: SendSessionInput): Promise<unknown>;
      sendDevelopment(input: SendDevelopmentSessionInput): Promise<unknown>;
      abort(sessionId: string): Promise<void>;
      compareCheckpoint(
        input: CompareCheckpointInput,
      ): Promise<CompareCheckpointResult>;
      list(): Promise<unknown>;
      messages(sessionId: string): Promise<unknown>;
      restoreCheckpoint(
        input: RestoreCheckpointInput,
      ): Promise<RestoreCheckpointResult>;
      usage(sessionId: string): Promise<AgentUsageSummary | undefined>;
      eventStreamUrl(sessionId: string): Promise<string | null>;
      onEvent(
        sessionId: string,
        callback: (event: AgentEvent) => void,
      ): () => void;
    };
    approvals: {
      resolve(input: ResolveApprovalInput): Promise<boolean>;
      onRequest(callback: (event: AgentEvent) => void): () => void;
    };
    initializations: {
      run(input: InitializeProjectInput): Promise<InitializeProjectResult>;
      repair(
        input: RepairProjectInitializationInput,
      ): Promise<RepairProjectInitializationResult>;
      assessImpact(
        input: AssessProjectInitializationImpactInput,
      ): Promise<AssessProjectInitializationImpactResult>;
    };
    newProjects: {
      generate(
        input: StartNewProjectGenerationInput,
      ): Promise<NewProjectGenerationResult>;
    };
    promptOptimizer: {
      optimizeUserStory(
        input: OptimizeUserStoryPromptInput,
      ): Promise<OptimizeUserStoryPromptResult>;
      generateUserStoryTitle(
        input: GenerateUserStoryTitleInput,
      ): Promise<GenerateUserStoryTitleResult>;
    };
    approveAndMerge(
      input: ApproveAndMergeInput,
    ): Promise<ApproveAndMergeResult>;
    generateCommitMessage(
      input: GenerateCommitMessageInput,
    ): Promise<GenerateCommitMessageResult>;
    resolveMergeConflicts(
      input: ResolveMergeConflictsInput,
    ): Promise<ResolveMergeConflictsResult>;
  };
};
