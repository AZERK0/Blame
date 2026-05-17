import * as React from "react"
import type {
  AgentEvent,
  ApiConnection as AgentApiConnection,
  LoginOAuthProviderInput,
  ProviderListResponse,
  ResolveApprovalInput,
  SaveProviderCredentialInput,
  SendSessionInput,
  StartSessionInput,
} from "@blame/agent-runtime"

export type ApiConnection = AgentApiConnection

type PickerPaths = string | string[] | null

export type OpenDirectoryPickerOptions = {
  title?: string
  multiple?: boolean
}

export type Platform = {
  agent?: AgentClient
  api?: ApiConnection
  terminal?: TerminalClient
  workspace?: WorkspaceClient
  openDirectoryPickerDialog?(
    options?: OpenDirectoryPickerOptions
  ): Promise<PickerPaths>
  openExternalLink?(url: string): void
}

export type AgentClient = {
  providers: {
    list(connection: ApiConnection): Promise<ProviderListResponse>
    saveCredential(connection: ApiConnection, input: SaveProviderCredentialInput): Promise<unknown>
    deleteCredential(connection: ApiConnection, id: number): Promise<void>
    loginOAuth(input: LoginOAuthProviderInput): Promise<unknown>
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

export type WorkspaceEntry = {
  name: string
  path: string
  type: "directory" | "file"
}

export type WorkspaceClient = {
  listDirectory(input: { root: string; path?: string }): Promise<WorkspaceEntry[]>
  readFile(input: { root: string; path: string }): Promise<string>
  searchFiles(input: { root: string; query: string; limit?: number }): Promise<WorkspaceEntry[]>
  gitDiff(input: { root: string }): Promise<string>
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
