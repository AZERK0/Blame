import type {
  AgentEvent,
  ApiConnection,
  ProviderListResponse,
  ResolveApprovalInput,
  SaveProviderCredentialInput,
  SendSessionInput,
  StartSessionInput,
} from "@blame/agent-runtime"

export type OpenDirectoryPickerOptions = {
  title?: string
  multiple?: boolean
}

export type WorkspaceEntry = {
  name: string
  path: string
  type: "directory" | "file"
}

export type BlameDesktopApi = {
  openDirectoryPicker(options?: OpenDirectoryPickerOptions): Promise<string | string[] | null>
  openExternalLink(url: string): void
  workspace: {
    listDirectory(input: { root: string; path?: string }): Promise<WorkspaceEntry[]>
    readFile(input: { root: string; path: string }): Promise<string>
    searchFiles(input: { root: string; query: string; limit?: number }): Promise<WorkspaceEntry[]>
    gitDiff(input: { root: string }): Promise<string>
  }
  agent: {
    providers: {
      list(connection: ApiConnection): Promise<ProviderListResponse>
      saveCredential(connection: ApiConnection, input: SaveProviderCredentialInput): Promise<unknown>
    }
    sessions: {
      start(input: StartSessionInput): Promise<{ sessionId: string }>
      send(input: SendSessionInput): Promise<unknown>
      abort(sessionId: string): Promise<void>
      list(): Promise<unknown>
      messages(sessionId: string): Promise<unknown>
      onEvent(sessionId: string, callback: (event: AgentEvent) => void): () => void
    }
    approvals: {
      resolve(input: ResolveApprovalInput): Promise<boolean>
      onRequest(callback: (event: AgentEvent) => void): () => void
    }
  }
}
