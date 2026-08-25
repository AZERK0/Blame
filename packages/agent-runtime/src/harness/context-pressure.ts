import type { CoreSessionConfig } from "@cline/sdk";
import type { ModelInfo } from "@cline/llms";

const clineAutomaticCompactionRatio = 0.9;
type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type BeforeModelContext = Parameters<NonNullable<AgentHooks["beforeModel"]>>[0];

export function effectiveCompactionModels(
  models: Record<string, ModelInfo>,
  modelId: string,
  triggerRatio: number,
) {
  const selected = models[modelId];
  if (!selected?.contextWindow) return models;
  const contextWindow = Math.floor(
    (selected.contextWindow * triggerRatio) / clineAutomaticCompactionRatio,
  );
  return { ...models, [modelId]: { ...selected, contextWindow } };
}

export function contextPressureHooks(input: {
  contextWindow?: number;
  warningRatio: number;
  onWarning?(usageRatio: number): void;
}): NonNullable<CoreSessionConfig["hooks"]> {
  let warned = false;
  return {
    beforeModel: ({ request }: BeforeModelContext) => {
      if (warned || !input.contextWindow) return undefined;
      const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
      const usageRatio = Math.ceil(requestBytes / 4) / input.contextWindow;
      if (usageRatio < input.warningRatio) return undefined;
      warned = true;
      input.onWarning?.(usageRatio);
      return undefined;
    },
  };
}
