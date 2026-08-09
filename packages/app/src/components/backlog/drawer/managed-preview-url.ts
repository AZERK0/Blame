import type {
  PreviewManifest,
  ProjectRunConfiguration,
} from "@blame/agent-runtime"
import type { EndpointMap } from "@blame/preview-runtime"

export function managedEmbeddedPreviewUrl(map: EndpointMap | undefined) {
  const route = map?.routes.find(
    ({ routeId }) => routeId === map.primaryRouteId
  )
  if (!route) return undefined
  if (map?.integratedPreviewRequired || !route.externallyCompatible) {
    return `http://localhost:${route.logicalPort}`
  }
  return route.publicUrl
}

export function managedPublicPreviewUrl(map: EndpointMap | undefined) {
  const route = map?.routes.find(
    ({ routeId }) => routeId === map.primaryRouteId
  )
  return route?.publicUrl
}

export function primaryPreviewRoute(
  manifest: PreviewManifest,
  configuration: ProjectRunConfiguration
) {
  const service = manifest.services.find(
    ({ id }) => id === configuration.previewService
  )
  if (!service) return undefined
  const candidates = service.endpoints.filter(
    ({ protocol }) => protocol !== "tcp"
  )
  const configuredPort = previewPort(configuration.previewUrl)
  const endpoint =
    candidates.find(({ port }) => port === configuredPort) ?? candidates[0]
  return endpoint
    ? { serviceId: service.id, endpointId: endpoint.id }
    : undefined
}

function previewPort(value: string | undefined) {
  try {
    if (!value) return undefined
    const url = new URL(value)
    return Number(url.port || (url.protocol === "https:" ? 443 : 80))
  } catch {
    return undefined
  }
}
