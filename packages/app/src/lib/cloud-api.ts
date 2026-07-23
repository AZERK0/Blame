import type {
  CloudProject,
  CloudProjectCodePracticeAnalysis,
  CloudProjectInitializationSnapshot,
  CloudSession,
  CloudUser,
  CloudLicense,
  type CloudAiPreferences,
  type CloudMcpConfiguration,
  type CloudMcpServer,
  SaveAiPreferencesInput,
  LoginInput,
  SignupInput,
  SocialAuthProvider,
} from "@/context/cloud-auth"
import type {
  ApiConnection,
  PreviewManifest,
  ProjectCodePracticeResult,
  ProjectRunConfiguration,
} from "@blame/agent-runtime"
import type { TelemetryExportSession } from "@/context/platform"

export class CloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = "CloudApiError"
  }
}

export type CloudAccountExport = {
  format: "blame-account-export"
  version: number
  generatedAt: string
  account: Record<string, unknown>
  security: Record<string, unknown>
  billing: Record<string, unknown> | null
  settings: Record<string, unknown>
  integrations: Record<string, unknown>
  workspace: Record<string, unknown>
  additionalRecords: Record<string, unknown>
}

export type CloudAccountClosureReceipt = {
  requestId: string
  receiptToken: string | null
  status: string
  requestedAt: string
  activeDeletionDeadline: string
  activeDeletionCompletedAt: string | null
  backupExpirationDeadline: string | null
  statusEndpoint: string
  supportContact: string
}

export function createCloudApi(connection: ApiConnection) {
  const baseUrl = connection.url.replace(/\/$/, "")

  return {
    login(input: LoginInput) {
      return betterAuthSessionRequest(
        connection,
        baseUrl,
        "/auth/sign-in/email",
        {
          body: JSON.stringify(input),
          method: "POST",
        }
      )
    },
    async signup(input: SignupInput) {
      await request<unknown>(connection, baseUrl, "/auth/sign-up/email", {
        body: JSON.stringify({
          email: input.email,
          name: input.fullName ?? input.email.split("@")[0],
          password: input.password,
        }),
        method: "POST",
      })
    },
    requestPasswordReset(email: string) {
      return request<unknown>(
        connection,
        baseUrl,
        "/auth/request-password-reset",
        {
          body: JSON.stringify({
            email,
            redirectTo: `${baseUrl}/auth/reset-password-page`,
          }),
          method: "POST",
        }
      ).then(() => undefined)
    },
    resetPassword(token: string, newPassword: string) {
      return request<unknown>(connection, baseUrl, "/auth/reset-password", {
        body: JSON.stringify({ token, newPassword }),
        method: "POST",
      }).then(() => undefined)
    },
    resendVerification(email: string) {
      return request<unknown>(
        connection,
        baseUrl,
        "/auth/send-verification-email",
        {
          body: JSON.stringify({
            email,
            callbackURL: `${baseUrl}/auth/verified`,
          }),
          method: "POST",
        }
      ).then(() => undefined)
    },
    async socialLogin(provider: SocialAuthProvider) {
      const result = await request<{ url?: string }>(
        connection,
        baseUrl,
        "/auth/sign-in/social",
        {
          body: JSON.stringify({
            provider,
            callbackURL: `${baseUrl}/auth/desktop-complete`,
            errorCallbackURL: `${baseUrl}/auth/desktop-complete?error=oauth_failed`,
            disableRedirect: true,
          }),
          method: "POST",
        }
      )
      if (!result.url)
        throw new CloudApiError("This provider is not configured.", 503)
      return result.url
    },
    passkeyLoginUrl() {
      return `${baseUrl}/auth/desktop?method=passkey`
    },
    exchangeDesktopCode(code: string) {
      return request<CloudSession>(
        connection,
        baseUrl,
        "/auth/desktop-exchange",
        {
          body: JSON.stringify({ code }),
          method: "POST",
        }
      )
    },
    profile() {
      return request<CloudUser>(connection, baseUrl, "/account/profile")
    },
    telemetrySession() {
      return request<unknown>(connection, baseUrl, "/telemetry/session").then(
        cloudTelemetrySession
      )
    },
    exportAccount(password: string) {
      return request<CloudAccountExport>(
        connection,
        baseUrl,
        "/account/export",
        { body: JSON.stringify({ password }), method: "POST" }
      )
    },
    closeAccount(input: { password: string; confirmation: string }) {
      return request<CloudAccountClosureReceipt>(
        connection,
        baseUrl,
        "/account/closure",
        { body: JSON.stringify(input), method: "POST" }
      )
    },
    closureStatus(requestId: string, receiptToken: string) {
      return request<CloudAccountClosureReceipt>(
        connection,
        baseUrl,
        "/account/closure-status",
        { body: JSON.stringify({ requestId, receiptToken }), method: "POST" }
      )
    },
    license() {
      return request<CloudLicense>(connection, baseUrl, "/billing")
    },
    checkout(cycle: "monthly" | "yearly") {
      return request<{ url: string }>(
        connection,
        baseUrl,
        "/billing/checkout",
        {
          body: JSON.stringify({ cycle }),
          method: "POST",
        }
      )
    },
    billingPortal() {
      return request<{ url: string }>(connection, baseUrl, "/billing/portal", {
        method: "POST",
      })
    },
    aiPreferences() {
      return request<unknown>(
        connection,
        baseUrl,
        "/account/ai-preferences"
      ).then(cloudAiPreferences)
    },
    saveAiPreferences(input: SaveAiPreferencesInput) {
      return request<unknown>(connection, baseUrl, "/account/ai-preferences", {
        body: JSON.stringify(input),
        method: "PUT",
      }).then(cloudAiPreferencesRequired)
    },
    mcpConfiguration() {
      return request<unknown>(
        connection,
        baseUrl,
        "/account/mcp-configurations"
      ).then(cloudMcpConfiguration)
    },
    saveMcpConfiguration(servers: CloudMcpServer[]) {
      return request<unknown>(
        connection,
        baseUrl,
        "/account/mcp-configurations",
        {
          body: JSON.stringify({ servers }),
          method: "PUT",
        }
      ).then(cloudMcpConfigurationRequired)
    },
    projects() {
      return request<unknown>(connection, baseUrl, "/projects").then(
        cloudProjects
      )
    },
    async logout() {
      await request<{ message: string }>(
        connection,
        baseUrl,
        "/account/logout",
        {
          method: "POST",
        }
      ).catch(() => undefined)
      await request<unknown>(connection, baseUrl, "/auth/sign-out", {
        method: "POST",
      }).catch(() => undefined)
    },
    ensureProject(input: {
      name: string
      repositoryFingerprint?: string | null
    }) {
      return request<unknown>(connection, baseUrl, "/projects", {
        body: JSON.stringify(input),
        method: "POST",
      }).then(cloudProject)
    },
    projectInitialization(projectId: string) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization`
      ).then(cloudProjectInitializationSnapshot)
    },
    projectCodePracticeAnalysis(projectId: string) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/code-practice-analysis`
      ).then(cloudProjectCodePracticeAnalysis)
    },
    startProjectCodePracticeAnalysis(
      projectId: string,
      input: { providerId: string; modelId: string }
    ) {
      return projectCodePracticeAnalysisRequest(
        connection,
        baseUrl,
        projectId,
        "start",
        input
      )
    },
    completeProjectCodePracticeAnalysis(
      projectId: string,
      input: {
        clineSessionId?: string | null
        practices: ProjectCodePracticeResult[]
      }
    ) {
      return projectCodePracticeAnalysisRequest(
        connection,
        baseUrl,
        projectId,
        "complete",
        input
      )
    },
    failProjectCodePracticeAnalysis(
      projectId: string,
      input: { clineSessionId?: string | null; error: string }
    ) {
      return projectCodePracticeAnalysisRequest(
        connection,
        baseUrl,
        projectId,
        "fail",
        input
      )
    },
    markProjectCodePracticeAnalysisViewed(projectId: string) {
      return projectCodePracticeAnalysisRequest(
        connection,
        baseUrl,
        projectId,
        "viewed",
        {}
      )
    },
    startProjectInitialization(
      projectId: string,
      input: {
        providerId: string
        modelId: string
        clineSessionId?: string | null
      }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/start`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
    completeProjectInitialization(
      projectId: string,
      input: {
        clineSessionId?: string | null
        previewManifest?: PreviewManifest
        setupScript: string
        dockerCompose: string
        runConfigurations: ProjectRunConfiguration[]
      }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/complete`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
    failProjectInitialization(
      projectId: string,
      input: { clineSessionId?: string | null; error: string }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/fail`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
    repairProjectInitialization(
      projectId: string,
      input: {
        clineSessionId?: string | null
        previewManifest?: PreviewManifest
        setupScript: string
        dockerCompose: string
        runConfigurations: ProjectRunConfiguration[]
        reason: string
      }
    ) {
      return request<unknown>(
        connection,
        baseUrl,
        `/projects/${encodeURIComponent(projectId)}/initialization/repair`,
        { body: JSON.stringify(input), method: "POST" }
      ).then(cloudProjectInitializationSnapshot)
    },
  }
}

function cloudProjects(value: unknown) {
  const projects = transformerValue(value)
  if (!Array.isArray(projects)) throw new Error("Unable to read projects.")
  return projects.map(cloudProject)
}

function cloudProject(value: unknown) {
  const project = transformerValue(value)
  if (!isRecord(project)) throw new Error("Unable to read project.")
  if (typeof project.id !== "string") throw new Error("Unable to read project.")
  if (typeof project.name !== "string")
    throw new Error("Unable to read project.")
  return project as CloudProject
}

function cloudProjectInitializationSnapshot(value: unknown) {
  const snapshot = transformerValue(value)
  if (!isRecord(snapshot))
    throw new Error("Unable to read project initialization.")
  if (!("practices" in snapshot) || !Array.isArray(snapshot.practices)) {
    throw new Error("Unable to read project initialization.")
  }
  if (
    "initialization" in snapshot &&
    snapshot.initialization !== null &&
    !isRecord(snapshot.initialization)
  ) {
    throw new Error("Unable to read project initialization.")
  }
  return snapshot as CloudProjectInitializationSnapshot
}

function cloudProjectCodePracticeAnalysis(value: unknown) {
  const analysis = transformerValue(value)
  if (!isRecord(analysis) || typeof analysis.projectId !== "string") {
    throw new Error("Unable to read project code practice analysis.")
  }
  return analysis as CloudProjectCodePracticeAnalysis
}

function projectCodePracticeAnalysisRequest(
  connection: ApiConnection,
  baseUrl: string,
  projectId: string,
  action: "start" | "complete" | "fail" | "viewed",
  body: unknown
) {
  return request<unknown>(
    connection,
    baseUrl,
    `/projects/${encodeURIComponent(projectId)}/code-practice-analysis/${action}`,
    { body: JSON.stringify(body), method: "POST" }
  ).then(cloudProjectCodePracticeAnalysis)
}

function cloudAiPreferences(value: unknown) {
  const preferences = transformerValue(value)
  if (preferences === null) return null
  return cloudAiPreferencesRequired(value)
}

function cloudAiPreferencesRequired(value: unknown) {
  const preferences = transformerValue(value)
  if (!isRecord(preferences)) throw new Error("Unable to read AI preferences.")
  if (
    !isRecord(preferences.alternativeModel) ||
    !isRecord(preferences.agentModel)
  ) {
    throw new Error("Unable to read AI preferences.")
  }
  return preferences as CloudAiPreferences
}

function cloudMcpConfiguration(value: unknown) {
  const configuration = transformerValue(value)
  if (configuration === null) return null
  return cloudMcpConfigurationRequired(value)
}

function cloudMcpConfigurationRequired(value: unknown) {
  const configuration = transformerValue(value)
  if (!isRecord(configuration) || !Array.isArray(configuration.servers))
    throw new Error("Unable to read MCP configuration.")
  return configuration as CloudMcpConfiguration
}

function cloudTelemetrySession(value: unknown): TelemetryExportSession {
  const session = transformerValue(value)
  if (!isRecord(session)) throw new Error("Unable to read telemetry session.")
  if (typeof session.endpoint !== "string")
    throw new Error("Unable to read telemetry session.")
  if (typeof session.expiresAt !== "string")
    throw new Error("Unable to read telemetry session.")
  if (typeof session.token !== "string")
    throw new Error("Unable to read telemetry session.")
  return session as TelemetryExportSession
}

function transformerValue(value: unknown): unknown {
  if (!isRecord(value)) return value
  if ("data" in value) return transformerValue(value.data)
  if (!Array.isArray(value.transformerData)) return value
  return transformerValue(value.transformerData[0])
}

async function request<T>(
  connection: ApiConnection,
  baseUrl: string,
  path: string,
  init?: RequestInit
) {
  const headers = new Headers(init?.headers)
  headers.set("Accept", "application/json")
  headers.set("Content-Type", "application/json")
  if (connection.token)
    headers.set("Authorization", `Bearer ${connection.token}`)

  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  })

  if (!response.ok) {
    throw new CloudApiError(await responseMessage(response), response.status)
  }
  if (response.status === 204) return undefined as T
  return responseData(await response.json()) as T
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function responseData(value: unknown) {
  if (!isRecord(value) || !("data" in value)) return value
  return value.data
}

async function betterAuthSessionRequest(
  connection: ApiConnection,
  baseUrl: string,
  path: string,
  init: RequestInit
) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  })
  if (!response.ok)
    throw new CloudApiError(await responseMessage(response), response.status)
  const token = response.headers.get("set-auth-token")
  const body = responseData(await response.json()) as {
    user?: {
      id: string
      name: string
      email: string
      createdAt: string
      updatedAt: string
    }
  }
  if (!token || !body.user)
    throw new CloudApiError("Sign-in could not be completed.", 401)
  const names = body.user.name.trim().split(/\s+/)
  const initials =
    names.length > 1
      ? `${names[0]?.[0] ?? ""}${names.at(-1)?.[0] ?? ""}`.toUpperCase()
      : body.user.email.slice(0, 2).toUpperCase()
  return {
    token,
    user: {
      id: body.user.id,
      fullName: body.user.name || null,
      email: body.user.email,
      createdAt: body.user.createdAt,
      updatedAt: body.user.updatedAt,
      initials,
    },
  } satisfies CloudSession
}

async function responseMessage(response: Response) {
  try {
    const body = await response.json()
    if (typeof body.message === "string") return body.message
    if (typeof body.error === "string") return body.error
  } catch {
    return `Request failed with status ${response.status}`
  }
  return `Request failed with status ${response.status}`
}
