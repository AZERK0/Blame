import type { CoreCompactionConfig } from "@cline/sdk";

const boundedProviders = new Set(["openai-native", "openai-codex"]);
const boundedModels = /^gpt-5\.6(?:-(?:sol|terra|luna))?(?:-\d{4}-\d{2}-\d{2})?$/u;

export function imageAwareCompaction(
  config: CoreCompactionConfig,
  providerId: string,
  modelId: string,
): CoreCompactionConfig {
  if (config.enabled === false || config.imageTokenLimit !== undefined) return config;
  if (!boundedProviders.has(providerId) || !boundedModels.test(modelId)) return config;
  return { ...config, imageTokenLimit: 36_000 };
}
