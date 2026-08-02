import * as React from "react"

import {
  CloudAuthContext,
  type CloudAiPreferences,
  type CloudSession,
  type CloudMcpConfiguration,
  type CloudMcpServer,
  type CloudLicense,
  type LoginInput,
  type LoginResult,
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
  | { status: "unauthenticated"; error?: string }
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
  const apiForToken = React.useCallback(
    (sessionToken?: string) =>
      createCloudApi({
        authRequest: platform.auth?.request,
        token: sessionToken,
        url: apiUrl,
      }),
    [apiUrl, platform.auth]
  )
  const cloudApi = React.useMemo(() => apiForToken(token), [apiForToken, token])
  useCloudTelemetry(platform.telemetry, apiConnection, Boolean(token))

  React.useEffect(() => {
    if (!platform.previewRuntime) return
    if (token) void platform.previewRuntime.configure({ url: apiUrl, token })
    else void platform.previewRuntime.disconnect()
    return () => {
      if (token) void platform.previewRuntime?.disconnect()
    }
  }, [apiUrl, platform.previewRuntime, token])

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

    const api = apiForToken(session.token)
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
  }, [apiForToken, platform.mcp])

  React.useEffect(() => {
    if (!platform.auth) return
    const unsubscribe = platform.auth.onCallback((result) => {
      if (result.error) {
        setState({
          status: "unauthenticated",
          ...(result.error === "email_verified"
            ? {}
            : {
                error:
                  "External sign-in was not completed. Please try again.",
              }),
        })
        return
      }
      if (!result.code) return
      setState({ status: "loading" })
      void exchangeDesktopAuthentication(apiForToken, result.code)
        .then(({ authenticatedState, session }) => {
          writeCloudSession(session)
          setState(authenticatedState)
        })
        .catch((error) => {
          setState({
            status: "unauthenticated",
            error:
              error instanceof Error
                ? error.message
                : "External sign-in could not be completed.",
          })
        })
    })
    platform.auth.ready()
    return unsubscribe
  }, [apiForToken, platform.auth])

  const completeDesktopAuthorization = React.useCallback(
    async (authorization: DesktopAuthorization) => {
      const deviceToken = await waitForDesktopAuthorization(
        cloudApi,
        authorization
      )
      const session = await cloudApi.exchangeDesktopDeviceToken(deviceToken)
      const authenticatedState = await hydrateSession(
        apiForToken(session.token),
        session
      )
      writeCloudSession(session)
      setState(authenticatedState)
    },
    [apiForToken, cloudApi]
  )

  const reportDesktopAuthorizationError = React.useCallback((error: unknown) => {
    setState((current) =>
      current.status === "authenticated"
        ? current
        : {
            status: "unauthenticated",
            error:
              error instanceof Error
                ? error.message
                : "External sign-in could not be completed.",
          }
    )
  }, [])

  const watchEmailVerification = React.useCallback(
    (authorization: DesktopAuthorization) => {
      void completeDesktopAuthorization(authorization).catch(
        reportDesktopAuthorizationError
      )
    },
    [completeDesktopAuthorization, reportDesktopAuthorizationError]
  )

  const login = React.useCallback(
    async (input: LoginInput): Promise<LoginResult> => {
      const result = await cloudApi.login(input)
      if (result === "two-factor") return result
      if ("authorization" in result) {
        watchEmailVerification(result.authorization)
        return "email-verification"
      }
      const session = result
      const api = apiForToken(session.token)
      const authenticatedState = await hydrateSession(api, session)
      writeCloudSession(session)
      setState(authenticatedState)
      return "authenticated"
    },
    [apiForToken, cloudApi, watchEmailVerification]
  )

  const verifyEmailTwoFactor = React.useCallback(
    async (code: string) => {
      const session = await cloudApi.verifyEmailTwoFactor(code)
      const authenticatedState = await hydrateSession(
        apiForToken(session.token),
        session
      )
      writeCloudSession(session)
      setState(authenticatedState)
    },
    [apiForToken, cloudApi]
  )

  const resendEmailTwoFactor = React.useCallback(
    () => cloudApi.resendEmailTwoFactor(),
    [cloudApi]
  )

  const signup = React.useCallback(
    async (input: SignupInput) => {
      const authorization = await cloudApi.signup(input)
      watchEmailVerification(authorization)
    },
    [cloudApi, watchEmailVerification]
  )

  const requestPasswordReset = React.useCallback(
    (email: string) => cloudApi.requestPasswordReset(email),
    [cloudApi]
  )
  const resetPassword = React.useCallback(
    (resetToken: string, password: string) =>
      cloudApi.resetPassword(resetToken, password),
    [cloudApi]
  )
  const resendVerification = React.useCallback(
    async (email: string) => {
      const authorization = await cloudApi.resendVerification(email)
      watchEmailVerification(authorization)
    },
    [cloudApi, watchEmailVerification]
  )

  const openExternalUrl = React.useCallback(
    (url: string) => {
      if (platform.openExternalLink) platform.openExternalLink(url)
      else window.open(url, "_blank", "noopener,noreferrer")
    },
    [platform]
  )

  const socialLogin = React.useCallback(
    async (provider: "github" | "google" | "microsoft") => {
      const authorization = await cloudApi.socialLogin(provider)
      openExternalUrl(authorization.verificationUrl)
      await completeDesktopAuthorization(authorization)
    },
    [cloudApi, completeDesktopAuthorization, openExternalUrl]
  )
  const passkeyLogin = React.useCallback(async () => {
    const authorization = await cloudApi.passkeyLogin()
    openExternalUrl(authorization.verificationUrl)
    await completeDesktopAuthorization(authorization)
  }, [cloudApi, completeDesktopAuthorization, openExternalUrl])

  const refreshAiPreferences = React.useCallback(async () => {
    if (!token) return
    const aiPreferences = await cloudApi.aiPreferences()
    setState((current) =>
      current.status === "authenticated"
        ? { ...current, aiPreferences }
        : current
    )
  }, [cloudApi, token])

  const saveAiPreferences = React.useCallback(
    async (input: SaveAiPreferencesInput) => {
      if (!token) return
      const aiPreferences = await cloudApi.saveAiPreferences(input)
      setState((current) =>
        current.status === "authenticated"
          ? { ...current, aiPreferences }
          : current
      )
    },
    [cloudApi, token]
  )

  const refreshLicense = React.useCallback(async () => {
    if (!token) return
    const license = await cloudApi.license()
    setState((current) =>
      current.status === "authenticated" ? { ...current, license } : current
    )
    return license
  }, [cloudApi, token])

  React.useEffect(() => {
    if (!platform.billing || !token) return
    const unsubscribe = platform.billing.onRefreshLicense(() => {
      void refreshLicense()
    })
    platform.billing.ready()
    return unsubscribe
  }, [platform.billing, refreshLicense, token])

  const startCheckout = React.useCallback(
    async (cycle: "monthly" | "yearly") => {
      openExternalUrl((await cloudApi.checkout(cycle)).url)
    },
    [cloudApi, openExternalUrl]
  )

  const openBillingPortal = React.useCallback(async () => {
    openExternalUrl((await cloudApi.billingPortal()).url)
  }, [cloudApi, openExternalUrl])

  const saveMcpConfiguration = React.useCallback(
    async (servers: CloudMcpServer[]) => {
      if (!token) return
      const mcpConfiguration = await cloudApi.saveMcpConfiguration(servers)
      setState((current) =>
        current.status === "authenticated"
          ? { ...current, mcpConfiguration }
          : current
      )
    },
    [cloudApi, token]
  )

  const logout = React.useCallback(async () => {
    try {
      if (token) {
        await cloudApi.logout().catch(() => undefined)
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
  }, [cloudApi, platform.mcp, state, token])

  return (
    <CloudAuthContext.Provider
      value={{
        apiConnection,
        aiPreferences:
          state.status === "authenticated" ? state.aiPreferences : undefined,
        mcpConfiguration:
          state.status === "authenticated" ? state.mcpConfiguration : undefined,
        license: state.status === "authenticated" ? state.license : undefined,
        error: state.status === "unauthenticated" ? state.error : undefined,
        login,
        passkeyLogin,
        logout,
        openBillingPortal,
        refreshAiPreferences,
        refreshLicense,
        requestPasswordReset,
        resendEmailTwoFactor,
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
        verifyEmailTwoFactor,
      }}
    >
      {children}
    </CloudAuthContext.Provider>
  )
}

async function exchangeDesktopAuthentication(
  apiForToken: (token?: string) => ReturnType<typeof createCloudApi>,
  code: string
) {
  const session = await apiForToken().exchangeDesktopCode(code)
  const authenticatedState = await hydrateSession(
    apiForToken(session.token),
    session
  )
  return { authenticatedState, session }
}

async function waitForDesktopAuthorization(
  api: ReturnType<typeof createCloudApi>,
  authorization: {
    deviceCode: string
    expiresIn: number
    interval: number
  }
) {
  const expiresAt = Date.now() + authorization.expiresIn * 1_000
  let interval = Math.max(authorization.interval, 1) * 1_000
  while (Date.now() < expiresAt) {
    await wait(interval)
    const result = await api.pollDesktopLogin(authorization.deviceCode)
    if (result.status === "authenticated") return result.accessToken
    if (result.status === "slow-down") interval += 5_000
  }
  throw new Error("This sign-in request expired. Try again.")
}

type DesktopAuthorization = {
  deviceCode: string
  expiresIn: number
  interval: number
  verificationUrl: string
}

function wait(duration: number) {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
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
