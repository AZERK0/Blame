import type { EndpointMap } from "@blame/preview-runtime"

export function managedEmbeddedPreviewUrl(map: EndpointMap | undefined) {
  const route = map?.routes.find(
    ({ endpointId }) => endpointId === map.primaryEndpointId
  )
  return route ? `http://localhost:${route.logicalPort}` : undefined
}
