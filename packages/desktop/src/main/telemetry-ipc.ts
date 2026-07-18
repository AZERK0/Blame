import { ipcMain } from "electron"
import {
  configureDesktopTelemetry,
  disableDesktopTelemetry,
} from "./desktop-telemetry"
import { sendRuntimeDiagnostic } from "./runtime-diagnostic"

export function registerTelemetryIpcHandlers() {
  ipcMain.handle("telemetry:configure", (_event, session) =>
    configureDesktopTelemetry(session)
  )
  ipcMain.handle("telemetry:disable", () => disableDesktopTelemetry())
  ipcMain.handle("telemetry:send-runtime-diagnostic", (_event, input) =>
    sendRuntimeDiagnostic(input)
  )
}
