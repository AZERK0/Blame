import * as React from "react"

import type { ApiConnection } from "@/context/platform"

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

export type CloudProject = {
  id: string
  userId: number
  repositoryFingerprint: string | null
  name: string
  createdAt: string
  updatedAt: string | null
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
  user?: CloudUser
  token?: string
  login(input: LoginInput): Promise<void>
  signup(input: SignupInput): Promise<void>
  logout(): Promise<void>
}

export const CloudAuthContext =
  React.createContext<CloudAuthContextValue | undefined>(undefined)

export function useCloudAuth() {
  const context = React.useContext(CloudAuthContext)
  if (!context)
    throw new Error("useCloudAuth must be used within CloudAuthProvider")
  return context
}
