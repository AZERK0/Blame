import { missingProviderModels } from "@blame/model-catalog";
import { getProviderCollectionSync } from "@cline/llms";
import type { CoreModelConfig } from "@cline/sdk";

/** knownModels is serialized by Cline for local, remote and delegated sessions. */
export function supplementalModelConfig<T extends CoreModelConfig>(
  config: T,
): T {
  const providerId = config.providerConfig?.providerId ?? config.providerId;
  const official = getProviderCollectionSync(providerId)?.models;
  // Never invent a new provider or overwrite a Cline registry entry.
  if (!official) return config;
  const missing = missingProviderModels(providerId, official);
  const modelId = config.providerConfig?.modelId ?? config.modelId;
  if (!Object.hasOwn(missing, modelId)) return config;
  return {
    ...config,
    knownModels: { ...missing, ...config.knownModels },
    ...(config.providerConfig
      ? {
          providerConfig: {
            ...config.providerConfig,
            knownModels: { ...missing, ...config.providerConfig.knownModels },
          },
        }
      : {}),
  };
}
