import * as React from "react"
import type { ApiConnection } from "@blame/agent-runtime"
import type { TelemetryClient } from "@/context/platform"
import { createCloudApi } from "@/lib/cloud-api"

const retryDelayMs = 30_000
const refreshLeadTimeMs = 120_000
const minimumRefreshDelayMs = 60_000

export function useCloudTelemetry(
  telemetry: TelemetryClient | undefined,
  connection: ApiConnection,
  authenticated: boolean
) {
  React.useEffect(() => {
    if (!telemetry) return
    if (!authenticated) {
      void telemetry.disable()
      return
    }
    return new CloudTelemetrySessionLoop(telemetry, connection).start()
  }, [authenticated, connection, telemetry])
}

class CloudTelemetrySessionLoop {
  private active = true
  private refreshTimer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly telemetry: TelemetryClient,
    private readonly connection: ApiConnection
  ) {}

  start() {
    void this.refresh()
    return () => this.stop()
  }

  private async refresh() {
    try {
      const session = await createCloudApi(this.connection).telemetrySession()
      const configured =
        this.active && (await this.telemetry.configure(session))
      this.schedule(configured ? refreshDelay(session.expiresAt) : retryDelayMs)
    } catch {
      this.schedule(retryDelayMs)
    }
  }

  private schedule(delay: number) {
    if (!this.active) return
    this.refreshTimer = setTimeout(() => void this.refresh(), delay)
  }

  private stop() {
    this.active = false
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
  }
}

function refreshDelay(expiresAt: string) {
  const refreshAt = Date.parse(expiresAt) - refreshLeadTimeMs
  if (!Number.isFinite(refreshAt)) return retryDelayMs
  return Math.max(minimumRefreshDelayMs, refreshAt - Date.now())
}
