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
