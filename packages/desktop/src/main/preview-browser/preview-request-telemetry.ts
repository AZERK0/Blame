import { getBlameTelemetry } from "@blame/telemetry"
import type { WebContents } from "electron"

export function attachPreviewRequestTelemetry(webContents: WebContents) {
  webContents.session.webRequest.onCompleted(
    { urls: ["http://*/*", "https://*/*"] },
    (details) => {
      if (details.statusCode < 500) return
      const attributes = {
        "http.response.status_code": details.statusCode,
        "network.protocol.name": details.url.startsWith("https:") ? "https" : "http",
        "blame.preview.resource_type": previewResourceType(details.resourceType),
      }
      const telemetry = getBlameTelemetry()
      telemetry.count("blame.preview.http.server_error", 1, attributes)
      telemetry.log("warn", "blame.preview.request.failed", attributes)
    },
  )
}

function previewResourceType(value: string) {
  return ["mainFrame", "subFrame", "xhr", "fetch"].includes(value) ? value : "other"
}
