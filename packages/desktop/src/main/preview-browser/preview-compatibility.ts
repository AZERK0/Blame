import type { EndpointMap } from "@blame/preview-runtime"

export function previewCompatibility(map: EndpointMap) {
  return map.integratedPreviewRequired
    ? {
        externalBrowserAvailable: false,
        message: "This preview uses localhost compatibility and is available only inside Blame.",
      }
    : { externalBrowserAvailable: true }
}
