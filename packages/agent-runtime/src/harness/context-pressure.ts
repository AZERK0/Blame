import type { CoreSessionConfig } from "@cline/sdk";
import type { ModelInfo } from "@cline/llms";

const clineAutomaticCompactionRatio = 0.9;
type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type BeforeModelContext = Parameters<NonNullable<AgentHooks["beforeModel"]>>[0];

export function effectiveCompactionModels(
  models: Record<string, ModelInfo>,
  modelId: string,
  triggerRatio: number,
  maximumContextTokens = 96_000,
) {
  const selected = models[modelId];
  if (!selected?.contextWindow) return models;
  const triggerTokens = Math.min(
    selected.contextWindow * triggerRatio,
    maximumContextTokens,
  );
  const contextWindow = Math.floor(
    triggerTokens / clineAutomaticCompactionRatio,
  );
  return { ...models, [modelId]: { ...selected, contextWindow } };
}

export function contextPressureHooks(input: {
  contextWindow?: number;
  onWarning?(usageRatio: number): void;
  warningRatio: number;
}): AgentHooks {
  let warned = false;
  return {
    beforeModel(context: BeforeModelContext) {
      const usageRatio = contextUsageRatio(context, input.contextWindow);
      if (!warned && usageRatio >= input.warningRatio) {
        warned = true;
        input.onWarning?.(usageRatio);
      }
      return undefined;
    },
  };
}

function contextUsageRatio(
  context: BeforeModelContext,
  contextWindow?: number,
) {
  if (!contextWindow) return 0;
  const bytes = Buffer.byteLength(JSON.stringify(context.request), "utf8");
  return Math.ceil(bytes / 4) / contextWindow;
}
