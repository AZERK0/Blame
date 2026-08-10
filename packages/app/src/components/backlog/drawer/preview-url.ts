export function previewPathUrl(source: string, path: string) {
  const url = new URL(source)
  return new URL(normalizePreviewPath(path), url.origin).toString()
}

export function previewAddressOrigin(source: string) {
  try {
    return new URL(source).origin
  } catch {
    return source
  }
}

export function blameCloudPreviewOrigin(source: string) {
  try {
    const url = new URL(source)
    const suffix = ".preview.blame.so"
    if (url.protocol !== "https:" || !url.hostname.endsWith(suffix)) {
      return undefined
    }
    const identifier = url.hostname.slice(0, -suffix.length)
    if (!identifier || identifier.includes(".")) return undefined
    return {
      identifier,
      compactIdentifier: compactPreviewIdentifier(identifier),
      protocol: `${url.protocol}//`,
      suffix,
    }
  } catch {
    return undefined
  }
}

function compactPreviewIdentifier(identifier: string) {
  if (identifier.length <= 7) return identifier
  return `${identifier.slice(0, 3)}…${identifier.slice(-3)}`
}

export function previewAddressPath(source: string) {
  try {
    const url = new URL(source)
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return "/"
  }
}

export function normalizePreviewPath(path: string) {
  const trimmed = path.trim()
  if (!trimmed) return "/"
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}
