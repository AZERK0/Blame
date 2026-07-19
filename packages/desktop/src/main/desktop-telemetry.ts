import {
  initializeBlameTelemetry,
  type TelemetryExportAuthorization,
} from "@blame/telemetry"
import type { TelemetryExportSession } from "@blame/app"

const productionEndpoint =
  "https://api.blame.so/api/v1/telemetry/otlp"
const developmentEndpoint = "http://localhost:3333/api/v1/telemetry/otlp"
let activeSession: TelemetryExportSession | undefined
let expectedEndpoint = productionEndpoint
let gatewayMode = true
let telemetryEnabled = false

const authorization: TelemetryExportAuthorization = {
  async headers(): Promise<Record<string, string>> {
    if (!sessionReady()) return {}
    return { Authorization: `Bearer ${activeSession!.token}` }
  },
  isReady: sessionReady,
}

export function initializeDesktopTelemetry(
  serviceVersion: string,
  packaged: boolean
) {
  const gatewayEndpoint = process.env.BLAME_TELEMETRY_ENDPOINT?.trim()
  const directEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  gatewayMode = Boolean(gatewayEndpoint) || !directEndpoint
  expectedEndpoint =
    gatewayEndpoint || directEndpoint || defaultEndpoint(packaged)
  const config = initializeBlameTelemetry({
    authorization: gatewayMode ? authorization : undefined,
    endpoint: expectedEndpoint,
    serviceName: "blame-desktop",
    serviceVersion,
  })
  telemetryEnabled = config.enabled
  return config
}

export function configureDesktopTelemetry(value: unknown) {
  if (!gatewayMode) return true
  if (
    !validSession(value) ||
    normalized(value.endpoint) !== normalized(expectedEndpoint)
  ) {
    return false
  }
  activeSession = value
  return true
}

export function disableDesktopTelemetry() {
  activeSession = undefined
  return true
}

export function desktopTelemetryReady() {
  return telemetryEnabled && (!gatewayMode || sessionReady())
}

function sessionReady() {
  return !!activeSession && Date.parse(activeSession.expiresAt) > Date.now()
}

function validSession(value: unknown): value is TelemetryExportSession {
  if (!isRecord(value)) return false
  if (typeof value.endpoint !== "string" || typeof value.expiresAt !== "string")
    return false
  if (typeof value.token !== "string" || value.token.length > 4096) return false
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value.token))
    return false
  const expiresAt = Date.parse(value.expiresAt)
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function normalized(value: string) {
  try {
    const url = new URL(value)
    url.pathname = url.pathname.replace(/\/+$/, "")
    return url.toString()
  } catch {
    return ""
  }
}

function defaultEndpoint(packaged: boolean) {
  return packaged ? productionEndpoint : developmentEndpoint
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}
