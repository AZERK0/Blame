import type { BlameProvider as Provider } from "@blame/agent-runtime"

export type AgentConversationResponseHeader = {
  modelName?: string
  provider: Provider
}

export function agentConversationResponseHeader({
  fallbackName = "Agent",
  modelId,
  providerId,
  providers,
}: {
  fallbackName?: string
  modelId?: string | null
  providerId?: string | null
  providers: Provider[]
}): AgentConversationResponseHeader {
  const provider = agentConversationProvider(
    providerId,
    providers,
    fallbackName
  )
  const modelName = modelId
    ? provider.models[modelId]?.name || modelId
    : undefined
  return {
    modelName,
    provider,
  }
}

function agentConversationProvider(
  providerId: string | null | undefined,
  providers: Provider[],
  fallbackName: string
): Provider {
  const provider = providers.find((item) => item.id === providerId)
  if (provider) return provider

  return {
    id: providerId || "synthetic",
    name: providerId ? humanizeProviderId(providerId) : fallbackName,
    models: {},
  }
}

function humanizeProviderId(providerId: string) {
  return providerId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}
