import type { DesktopBridgeGrant } from "../preview-runtime/cloud-preview-client"

export type PreviewBridgeRoute = DesktopBridgeGrant["routes"][number]

const logicalHosts = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"])

export class PreviewRouteTable {
  private routes = new Map<number, PreviewBridgeRoute>()

  replace(grant: DesktopBridgeGrant) {
    const next = new Map<number, PreviewBridgeRoute>()
    for (const route of grant.routes) {
      validateRoute(route)
      if (next.has(route.logicalPort)) throw new Error("Duplicate logical preview port")
      next.set(route.logicalPort, structuredClone(route))
    }
    this.routes = next
  }

  clear() {
    this.routes.clear()
  }

  resolve(value: string) {
    const url = parseLogicalUrl(value)
    const route = this.routes.get(logicalPort(url))
    if (!route) throw new Error("Localhost preview port is not declared")
    return { route, url }
  }

  isExpectedOrigin(value: string | undefined) {
    if (!value) return false
    try {
      const url = new URL(value)
      return logicalHosts.has(url.hostname) && this.routes.has(logicalPort(url))
    } catch {
      return false
    }
  }

  rewriteProviderLocation(value: string) {
    try {
      const location = new URL(value)
      for (const route of this.routes.values()) {
        if (location.origin !== new URL(route.providerUrl).origin) continue
        location.protocol = route.protocol === "ws" || route.protocol === "wss" ? "ws:" : "http:"
        location.hostname = route.logicalHost
        location.port = String(route.logicalPort)
        return location.toString()
      }
    } catch {}
    return value
  }
}

export function parseLogicalUrl(value: string) {
  const rawAuthority = value.match(/^(?:http|ws):\/\/([^/?#]+)/i)?.[1]
  if (!rawAuthority || rawAuthority.includes("@")) throw new Error("Logical preview URL is invalid")
  const rawHost = rawAuthority.startsWith("[")
    ? rawAuthority.slice(0, rawAuthority.indexOf("]") + 1).toLowerCase()
    : rawAuthority.split(":", 1)[0]!.toLowerCase()
  if (!logicalHosts.has(rawHost)) throw new Error("Preview destination is not canonical localhost")
  const url = new URL(value)
  if (url.username || url.password || url.hash) throw new Error("Logical preview URL is invalid")
  if (!["http:", "ws:"].includes(url.protocol)) {
    throw new Error("Only V1 HTTP and WebSocket localhost origins are supported")
  }
  if (!logicalHosts.has(url.hostname)) throw new Error("Preview destination is not canonical localhost")
  const port = logicalPort(url)
  if (port < 1 || port > 65_535) throw new Error("Logical preview port is invalid")
  return url
}

function logicalPort(url: URL) {
  return Number(url.port || (url.protocol === "http:" || url.protocol === "ws:" ? 80 : 443))
}

function validateRoute(route: PreviewBridgeRoute) {
  if (
    route.logicalHost !== "localhost" ||
    !Number.isSafeInteger(route.logicalPort) ||
    route.logicalPort < 1 ||
    route.logicalPort > 65_535 ||
    !["http", "ws", "https", "wss"].includes(route.protocol) ||
    !route.endpointId
  ) throw new Error("Preview route is invalid")
  const provider = new URL(route.providerUrl)
  if (
    provider.protocol !== "https:" || provider.username || provider.password || provider.hash ||
    (!provider.hostname.endsWith(".vercel.run") && !provider.hostname.endsWith(".vercel.app"))
  ) throw new Error("Preview provider route is not trusted")
  if (!route.capability || Date.parse(route.capabilityExpiresAt) <= Date.now()) {
    throw new Error("Preview capability is expired")
  }
}
