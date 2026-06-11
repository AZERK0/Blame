import * as React from "react"

import type {
  ApiConnection,
  ProjectRunConfiguration,
} from "@blame/agent-runtime"
import type { ReasoningEffort } from "@blame/agent-runtime"

export type CloudUser = {
  id: number
  fullName: string | null
  email: string
  createdAt: string
  updatedAt: string
  initials: string
}

export type CloudSession = {
  user: CloudUser
  token: string
}

export type CloudAiModelPreference = {
  providerId: string
  modelId: string
  credentialLabel: string | null
  reasoningEffort: ReasoningEffort | null
}

export type CloudAiPreferences = {
  alternativeModel: CloudAiModelPreference
  agentModel: CloudAiModelPreference
  createdAt: string
  updatedAt: string | null
}

export type CloudProject = {
  id: string
  userId: number
  repositoryFingerprint: string | null
  name: string
  createdAt: string
  updatedAt: string | null
}

export type CloudProjectInitializationStatus =
  | "pending"
  | "running"
  | "done"
  | "error"

export type CloudProjectCodePracticeKey =
  | "coding_style"
  | "unit_tests"
  | "layered_architecture"
  | "commit_message_convention"

export type CloudProjectInitialization = {
  projectId: string
  status: CloudProjectInitializationStatus
  step: string
  clineSessionId: string | null
  agentProviderId: string | null
  agentModelId: string | null
  setupScript: string | null
  dockerCompose: string | null
  runConfigurations: ProjectRunConfiguration[]
  error: string | null
  repairReason: string | null
  createdAt: string
  updatedAt: string | null
}

export type CloudProjectCodePractice = {
  id: number
  projectId: string
  practice: CloudProjectCodePracticeKey
  detected: boolean
  enabled: boolean
  comment: string
  createdAt: string
  updatedAt: string | null
}

export type CloudProjectInitializationSnapshot = {
  initialization: CloudProjectInitialization | null
  practices: CloudProjectCodePractice[]
}

export type LoginInput = {
  email: string
  password: string
}

export type SignupInput = LoginInput & {
  fullName: string | null
  passwordConfirmation: string
}

export type CloudAuthContextValue = {
  status: "loading" | "authenticated" | "unauthenticated"
  apiConnection: ApiConnection
  aiPreferences?: CloudAiPreferences | null
  user?: CloudUser
  token?: string
  login(input: LoginInput): Promise<void>
  signup(input: SignupInput): Promise<void>
  saveAiPreferences(input: SaveAiPreferencesInput): Promise<void>
  refreshAiPreferences(): Promise<void>
  logout(): Promise<void>
}

export type SaveAiPreferencesInput = {
  alternativeModel: CloudAiModelPreference
  agentModel: CloudAiModelPreference
}

export const CloudAuthContext = React.createContext<
  CloudAuthContextValue | undefined
>(undefined)

export function useCloudAuth() {
  const context = React.useContext(CloudAuthContext)
  if (!context)
    throw new Error("useCloudAuth must be used within CloudAuthProvider")
  return context
}
