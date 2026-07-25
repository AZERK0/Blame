import { ipcMain } from "electron"
import {
  configureDesktopTelemetry,
  disableDesktopTelemetry,
} from "./desktop-telemetry"
import { sendRuntimeDiagnostic } from "./runtime-diagnostic"

type TelemetryIpcCallbacks = {
  configure?(session: unknown): void
  disable?(): void
}

export function registerTelemetryIpcHandlers(
  callbacks: TelemetryIpcCallbacks = {}
) {
  ipcMain.handle("telemetry:configure", (_event, session) => {
    const configured = configureDesktopTelemetry(session)
    if (configured) callbacks.configure?.(session)
    return configured
  })
  ipcMain.handle("telemetry:disable", () => {
    const disabled = disableDesktopTelemetry()
    callbacks.disable?.()
    return disabled
  })
  ipcMain.handle("telemetry:send-runtime-diagnostic", (_event, input) =>
    sendRuntimeDiagnostic(input)
  )
}
