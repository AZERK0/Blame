import * as React from "react"

import {
  CloudAuthContext,
  type CloudSession,
  type LoginInput,
  type SignupInput,
} from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import { createCloudApi } from "@/lib/cloud-api"

const storageKey = "blame.app.cloud-session.v1"
const defaultApiUrl = "https://api.blame.raphael-charpentier.fr/api/v1"

type CloudAuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "authenticated"; session: CloudSession }

export function CloudAuthProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const [state, setState] = React.useState<CloudAuthState>({
    status: "loading",
  })
  const apiUrl = platform.api?.url ?? defaultApiUrl
  const token = state.status === "authenticated" ? state.session.token : undefined
  const apiConnection = React.useMemo(
    () => ({ url: apiUrl, token }),
    [apiUrl, token]
  )

  React.useEffect(() => {
    let alive = true
    const session = readCloudSession()
    if (!session) {
      setState({ status: "unauthenticated" })
      return () => {
        alive = false
      }
    }

    void createCloudApi({ url: apiUrl, token: session.token })
      .profile()
      .then((user) => {
        if (!alive) return
        setCloudSession({ ...session, user })
        setState({ status: "authenticated", session: { ...session, user } })
      })
      .catch(() => {
        if (!alive) return
        removeCloudSession()
        setState({ status: "unauthenticated" })
      })

    return () => {
      alive = false
    }
  }, [apiUrl])

  const login = React.useCallback(
    async (input: LoginInput) => {
      const session = await createCloudApi({ url: apiUrl }).login(input)
      setCloudSession(session)
      setState({ status: "authenticated", session })
    },
    [apiUrl]
  )

  const signup = React.useCallback(
    async (input: SignupInput) => {
      const session = await createCloudApi({ url: apiUrl }).signup(input)
      setCloudSession(session)
      setState({ status: "authenticated", session })
    },
    [apiUrl]
  )

  const logout = React.useCallback(async () => {
    if (token) {
      await createCloudApi(apiConnection).logout().catch(() => undefined)
    }
    removeCloudSession()
    setState({ status: "unauthenticated" })
  }, [apiConnection, token])

  return (
    <CloudAuthContext.Provider
      value={{
        apiConnection,
        login,
        logout,
        signup,
        status: state.status,
        token,
        user: state.status === "authenticated" ? state.session.user : undefined,
      }}
    >
      {children}
    </CloudAuthContext.Provider>
  )
}

function readCloudSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) ?? "")
    if (!isCloudSession(parsed)) return undefined
    return parsed
  } catch {
    return undefined
  }
}

function setCloudSession(session: CloudSession) {
  localStorage.setItem(storageKey, JSON.stringify(session))
}

function removeCloudSession() {
  localStorage.removeItem(storageKey)
}

function isCloudSession(value: unknown): value is CloudSession {
  if (!value || typeof value !== "object") return false
  if (!("token" in value) || typeof value.token !== "string") return false
  if (!("user" in value) || !value.user || typeof value.user !== "object")
    return false
  if (!("id" in value.user) || typeof value.user.id !== "number") return false
  if (!("email" in value.user) || typeof value.user.email !== "string")
    return false
  return "initials" in value.user && typeof value.user.initials === "string"
}
