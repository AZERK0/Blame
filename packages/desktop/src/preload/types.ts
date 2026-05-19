import type {
  AgentEvent,
  ApiConnection,
  InitializeProjectInput,
  InitializeProjectResult,
  LoginOAuthProviderInput,
  ProviderListResponse,
  ResolveApprovalInput,
  SaveProviderCredentialInput,
  SendSessionInput,
  StartSessionInput,
} from "@blame/agent-runtime";

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

export type TerminalEvent = {
  id: string;
  type: "stdout" | "stderr" | "exit";
  data: string;
};

export type BlameDesktopApi = {
  openDirectoryPicker(
    options?: OpenDirectoryPickerOptions,
  ): Promise<string | string[] | null>;
  openExternalLink(url: string): void;
  workspace: {
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
    gitRepositoryFingerprint(input: { root: string }): Promise<string | null>;
    createWorktree(input: {
      repositoryRoot: string;
      storyId: number;
      title: string;
    }): Promise<WorktreeResult>;
    runProjectSetup(input: {
      worktree: string;
      setupScript: string;
      dockerCompose: string;
    }): Promise<{ runId: string }>;
    stopProjectSetup(input: { worktree: string }): Promise<boolean>;
    removeWorktree(input: {
      repositoryRoot: string;
      worktree: string;
    }): Promise<boolean>;
    onSetupEvent(
      runId: string,
      callback: (event: ProjectSetupEvent) => void,
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
      deleteCredential(connection: ApiConnection, id: number): Promise<void>;
      loginOAuth(input: LoginOAuthProviderInput): Promise<unknown>;
    };
    sessions: {
      start(input: StartSessionInput): Promise<{ sessionId: string }>;
      send(input: SendSessionInput): Promise<unknown>;
      abort(sessionId: string): Promise<void>;
      list(): Promise<unknown>;
      messages(sessionId: string): Promise<unknown>;
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
    };
  };
};
