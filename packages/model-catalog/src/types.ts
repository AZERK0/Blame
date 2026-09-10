import type { ModelInfo } from "@cline/shared";

/** An exact provider/model pair, never a provider-wide allowlist bypass. */
export interface SupplementalModel {
  providerId: string;
  model: ModelInfo;
  source: string;
  verifiedAt: string;
  enabled?: boolean;
}

export type ProviderModels = Record<string, ModelInfo>;
