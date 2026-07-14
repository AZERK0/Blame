import { app } from "electron"
import { initializeDesktopTelemetry } from "./desktop-telemetry"

initializeDesktopTelemetry(app.getVersion(), app.isPackaged)

await import("./index")
