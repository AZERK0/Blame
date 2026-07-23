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
import { useCloudTelemetry } from "@/context/cloud-telemetry"

const configuredApiUrl = import.meta.env.VITE_CLOUD_API_URL?.trim()
const defaultApiUrl =
  configuredApiUrl || "https://api.blame.so/api/v1"

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
  useCloudTelemetry(platform.telemetry, apiConnection, Boolean(token))

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

    const api = createCloudApi({ url: apiUrl, token: session.token })
    void hydrateSession(api, session, true)
      .then((authenticatedState) => {
        if (!alive) return
        writeCloudSession(authenticatedState.session)
        setState(authenticatedState)
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
  }, [apiUrl, platform.mcp])

  React.useEffect(() => {
    if (!platform.auth) return
    const unsubscribe = platform.auth.onCallback((result) => {
      if (!result.code) return
      void createCloudApi({ url: apiUrl })
        .exchangeDesktopCode(result.code)
        .then(async (session) => {
          const authenticatedState = await hydrateSession(
            createCloudApi({ url: apiUrl, token: session.token }),
            session
          )
          writeCloudSession(session)
          setState(authenticatedState)
        })
    })
    platform.auth.ready()
    return unsubscribe
  }, [apiUrl, platform.auth])

  const login = React.useCallback(
    async (input: LoginInput) => {
      const session = await createCloudApi({ url: apiUrl }).login(input)
      const api = createCloudApi({
        url: apiUrl,
        token: session.token,
      })
      const authenticatedState = await hydrateSession(api, session)
      writeCloudSession(session)
      setState(authenticatedState)
    },
    [apiUrl]
  )

  const signup = React.useCallback(
    async (input: SignupInput) => {
      await createCloudApi({ url: apiUrl }).signup(input)
    },
    [apiUrl]
  )

  const requestPasswordReset = React.useCallback(
    (email: string) => createCloudApi({ url: apiUrl }).requestPasswordReset(email),
    [apiUrl]
  )
  const resetPassword = React.useCallback(
    (resetToken: string, password: string) =>
      createCloudApi({ url: apiUrl }).resetPassword(resetToken, password),
    [apiUrl]
  )
  const resendVerification = React.useCallback(
    (email: string) => createCloudApi({ url: apiUrl }).resendVerification(email),
    [apiUrl]
  )
  const socialLogin = React.useCallback(
    async (provider: "github" | "google" | "microsoft") => {
      const url = await createCloudApi({ url: apiUrl }).socialLogin(provider)
      if (platform.openExternalLink) platform.openExternalLink(url)
      else window.open(url, "_blank", "noopener,noreferrer")
    },
    [apiUrl, platform]
  )
  const passkeyLogin = React.useCallback(async () => {
    const url = createCloudApi({ url: apiUrl }).passkeyLoginUrl()
    if (platform.openExternalLink) platform.openExternalLink(url)
    else window.open(url, "_blank", "noopener,noreferrer")
  }, [apiUrl, platform])

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

  React.useEffect(() => {
    if (!platform.billing || !token) return
    const unsubscribe = platform.billing.onRefreshLicense(() => {
      void refreshLicense()
    })
    platform.billing.ready()
    return unsubscribe
  }, [platform.billing, refreshLicense, token])

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
    try {
      if (token) {
        await createCloudApi(apiConnection)
          .logout()
          .catch(() => undefined)
      }
      if (state.status === "authenticated") {
        await platform.mcp?.detachCloud(state.session.user.id)
      }
    } catch {
      return
    } finally {
      removeCloudSession()
      setState({ status: "unauthenticated" })
    }
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
        passkeyLogin,
        logout,
        openBillingPortal,
        refreshAiPreferences,
        refreshLicense,
        requestPasswordReset,
        resendVerification,
        resetPassword,
        saveAiPreferences,
        saveMcpConfiguration,
        signup,
        socialLogin,
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

const unavailableLicense: CloudLicense = {
  licensed: false,
  status: "unavailable",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
}

async function hydrateSession(
  api: ReturnType<typeof createCloudApi>,
  session: CloudSession,
  refreshProfile = false
): Promise<Extract<CloudAuthState, { status: "authenticated" }>> {
  const user = refreshProfile ? await api.profile() : session.user
  const [license, aiPreferences, mcpConfiguration] = await Promise.all([
    api.license().catch(() => unavailableLicense),
    api.aiPreferences().catch(() => null),
    api.mcpConfiguration().catch(() => null),
  ])
  return {
    status: "authenticated",
    session: { ...session, user },
    aiPreferences,
    mcpConfiguration,
    license,
  }
}
