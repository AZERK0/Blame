import { boundedMetricDimensionName } from "./redaction.js";

export const genAiDurationBucketBoundaries = [
  0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.28, 2.56, 5.12, 10.24, 20.48,
  40.96, 81.92,
];

export const genAiTokenBucketBoundaries = [
  1, 4, 16, 64, 256, 1_024, 4_096, 16_384, 65_536, 262_144, 1_048_576,
  4_194_304, 16_777_216, 67_108_864,
];

export function semanticGenAiProviderName(value: string) {
  const providerName = boundedMetricDimensionName(value.toLowerCase());
  return providerAliases.get(providerName) ?? providerName;
}

const providerAliases = new Map([
  ["aws-bedrock", "aws.bedrock"],
  ["azure-openai", "azure.ai.openai"],
  ["gemini", "gcp.gemini"],
  ["google-gemini", "gcp.gemini"],
  ["google-vertex", "gcp.vertex_ai"],
  ["ibm-watsonx", "ibm.watsonx.ai"],
  ["mistral", "mistral_ai"],
  ["mistral-ai", "mistral_ai"],
  ["openai-codex", "openai"],
  ["vertex-ai", "gcp.vertex_ai"],
  ["x-ai", "x_ai"],
  ["xai", "x_ai"],
]);
