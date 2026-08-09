import type { PreviewSessionCommand } from "@blame/preview-runtime"

export function managedPreviewStopCommand(
  action: "stop" | "restart"
): PreviewSessionCommand {
  return action === "stop"
    ? { type: "suspend-host" }
    : { type: "stop-services" }
}
