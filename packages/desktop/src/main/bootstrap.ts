import { initializeBlameTelemetry } from "@blame/telemetry"
import { app } from "electron"

initializeBlameTelemetry({
  serviceName: "blame-desktop",
  serviceVersion: app.getVersion(),
})

await import("./index")
