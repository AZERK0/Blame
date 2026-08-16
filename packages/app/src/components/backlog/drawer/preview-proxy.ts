export type PreviewProxyInfo = {
  kind: "cloud" | "local"
  logicalUrl: string
  reasons: string[]
}

export function activePreviewProxy(input: {
  cloudBridgeRequired: boolean
  localBridgeActive: boolean
  logicalUrl?: string
  presentedUrl?: string
  publicUrl?: string
  reasons?: string[]
}): PreviewProxyInfo | undefined {
  if (!input.logicalUrl) return undefined
  if (input.localBridgeActive) {
    return {
      kind: "local",
      logicalUrl: input.logicalUrl,
      reasons: [],
    }
  }
  if (
    !input.cloudBridgeRequired ||
    !input.publicUrl ||
    !input.presentedUrl ||
    input.presentedUrl === input.logicalUrl
  ) {
    return undefined
  }
  return {
    kind: "cloud",
    logicalUrl: input.logicalUrl,
    reasons: input.reasons ?? [],
  }
}
