import * as React from "react"

import {
  CloudAuthContext,
  type CloudAiPreferences,
  type CloudSession,
  type CloudMcpConfiguration,
  type CloudMcpServer,
  type CloudLicense,
  type LoginInput,
  type SaveAiPreferencesInput,
  type SignupInput,
} from "@/context/cloud-auth"
import { usePlatform } from "@/context/platform"
import {
  readCloudSession,
  removeCloudSession,
  writeCloudSession,
} from "@/context/cloud-auth-storage"
import { createCloudApi } from "@/lib/cloud-api"

const configuredApiUrl = import.meta.env.VITE_CLOUD_API_URL?.trim()
const defaultApiUrl =
  configuredApiUrl || "https://api.blame.raphael-charpentier.fr/api/v1"

type CloudAuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "authenticated"
      session: CloudSession
      aiPreferences: CloudAiPreferences | null
      mcpConfiguration: CloudMcpConfiguration | null
      license: CloudLicense
    }

export function CloudAuthProvider({ children }: { children: React.ReactNode }) {
  const platform = usePlatform()
  const [state, setState] = React.useState<CloudAuthState>({
    status: "loading",
  })
  const apiUrl = platform.api?.url ?? defaultApiUrl
  const token =
    state.status === "authenticated" ? state.session.token : undefined
  const apiConnection = React.useMemo(
    () => ({ url: apiUrl, token }),
    [apiUrl, token]
  )

  React.useEffect(() => {
    let alive = true
    const session = readCloudSession()
    if (!session) {
      queueMicrotask(() => {
        if (alive) setState({ status: "unauthenticated" })
      })
      return () => {
        alive = false
      }
    }

    void createCloudApi({ url: apiUrl, token: session.token })
      .profile()
      .then(async (user) => {
        if (!alive) return
        const api = createCloudApi({
          url: apiUrl,
          token: session.token,
        })
        const [license, aiPreferences, mcpConfiguration] = await Promise.all([
          api.license(),
          api.aiPreferences(),
          api.mcpConfiguration().catch(() => null),
        ])
        writeCloudSession({ ...session, user })
        setState({
          status: "authenticated",
          session: { ...session, user },
          aiPreferences,
          mcpConfiguration,
          license,
        })
      })
      .catch(() => {
        if (!alive) return
        void platform.mcp?.detachCloud(session.user.id)
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
      const api = createCloudApi({
        url: apiUrl,
        token: session.token,
      })
      const [license, aiPreferences, mcpConfiguration] = await Promise.all([
        api.license(),
        api.aiPreferences(),
        api.mcpConfiguration().catch(() => null),
      ])
      writeCloudSession(session)
      setState({
        status: "authenticated",
        session,
        aiPreferences,
        mcpConfiguration,
        license,
      })
    },
    [apiUrl]
  )

  const signup = React.useCallback(
    async (input: SignupInput) => {
      const session = await createCloudApi({ url: apiUrl }).signup(input)
      const api = createCloudApi({
        url: apiUrl,
        token: session.token,
      })
      const [license, aiPreferences, mcpConfiguration] = await Promise.all([
        api.license(),
        api.aiPreferences(),
        api.mcpConfiguration().catch(() => null),
      ])
      writeCloudSession(session)
      setState({
        status: "authenticated",
        session,
        aiPreferences,
        mcpConfiguration,
        license,
      })
    },
    [apiUrl]
  )

  const refreshAiPreferences = React.useCallback(async () => {
    if (!token) return
    const aiPreferences = await createCloudApi(apiConnection).aiPreferences()
    setState((current) =>
      current.status === "authenticated"
        ? { ...current, aiPreferences }
        : current
    )
  }, [apiConnection, token])

  const saveAiPreferences = React.useCallback(
    async (input: SaveAiPreferencesInput) => {
      if (!token) return
      const aiPreferences =
        await createCloudApi(apiConnection).saveAiPreferences(input)
      setState((current) =>
        current.status === "authenticated"
          ? { ...current, aiPreferences }
          : current
      )
    },
    [apiConnection, token]
  )

  const refreshLicense = React.useCallback(async () => {
    if (!token) return
    const license = await createCloudApi(apiConnection).license()
    setState((current) =>
      current.status === "authenticated" ? { ...current, license } : current
    )
  }, [apiConnection, token])

  const openBillingUrl = React.useCallback(
    (url: string) => {
      if (platform.openExternalLink) platform.openExternalLink(url)
      else window.open(url, "_blank", "noopener,noreferrer")
    },
    [platform]
  )

  const startCheckout = React.useCallback(
    async (cycle: "monthly" | "yearly") => {
      openBillingUrl((await createCloudApi(apiConnection).checkout(cycle)).url)
    },
    [apiConnection, openBillingUrl]
  )

  const openBillingPortal = React.useCallback(async () => {
    openBillingUrl((await createCloudApi(apiConnection).billingPortal()).url)
  }, [apiConnection, openBillingUrl])

  const saveMcpConfiguration = React.useCallback(
    async (servers: CloudMcpServer[]) => {
      if (!token) return
      const mcpConfiguration =
        await createCloudApi(apiConnection).saveMcpConfiguration(servers)
      setState((current) =>
        current.status === "authenticated"
          ? { ...current, mcpConfiguration }
          : current
      )
    },
    [apiConnection, token]
  )

  const logout = React.useCallback(async () => {
    if (token) {
      await createCloudApi(apiConnection)
        .logout()
        .catch(() => undefined)
    }
    if (state.status === "authenticated") {
      await platform.mcp?.detachCloud(state.session.user.id)
    }
    removeCloudSession()
    setState({ status: "unauthenticated" })
  }, [apiConnection, platform.mcp, state, token])

  return (
    <CloudAuthContext.Provider
      value={{
        apiConnection,
        aiPreferences:
          state.status === "authenticated" ? state.aiPreferences : undefined,
        mcpConfiguration:
          state.status === "authenticated" ? state.mcpConfiguration : undefined,
        license: state.status === "authenticated" ? state.license : undefined,
        login,
        logout,
        openBillingPortal,
        refreshAiPreferences,
        refreshLicense,
        saveAiPreferences,
        saveMcpConfiguration,
        signup,
        startCheckout,
        status: state.status,
        token,
        user: state.status === "authenticated" ? state.session.user : undefined,
      }}
    >
      {children}
    </CloudAuthContext.Provider>
  )
}
