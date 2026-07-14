import { ipcMain } from "electron"
import {
  configureDesktopTelemetry,
  disableDesktopTelemetry,
} from "./desktop-telemetry"

export function registerTelemetryIpcHandlers() {
  ipcMain.handle("telemetry:configure", (_event, session) =>
    configureDesktopTelemetry(session)
  )
  ipcMain.handle("telemetry:disable", () => disableDesktopTelemetry())
}
