import type { CoreSessionConfig } from "@cline/sdk";
import type { ModelInfo } from "@cline/llms";

const clineAutomaticCompactionRatio = 0.9;
type AgentHooks = NonNullable<CoreSessionConfig["hooks"]>;
type BeforeModelContext = Parameters<NonNullable<AgentHooks["beforeModel"]>>[0];
type AgentMessages = BeforeModelContext["request"]["messages"];
type AgentMessage = AgentMessages[number];
type AgentMessagePart = AgentMessage["content"][number];

export type ContextPressureMetrics = {
  estimatedTokens: number;
  iteration: number;
  marginalTokens: number;
  noveltyRatio: number;
  oldToolResultTokens: number;
  toolResultCount: number;
};

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
  checkpointIteration?: number;
  compact?(
    metrics: ContextPressureMetrics,
    reason: string,
  ): Promise<AgentMessages>;
  contextWindow?: number;
  marginalTokenThreshold?: number;
  maximumContextTokens?: number;
  maximumOldToolResultTokens?: number;
  minimumNoveltyRatio?: number;
  onCompaction?(metrics: ContextPressureMetrics, reason: string): void;
  onWarning?(usageRatio: number): void;
  terminalIteration?: number;
  terminalToolNames?: string[];
  warningRatio: number;
}): NonNullable<CoreSessionConfig["hooks"]> {
  let compactedIteration = -10;
  let previousTokens = 0;
  let warned = false;
  return {
    async beforeModel(context: BeforeModelContext) {
      const metrics = pressureMetrics(context, previousTokens);
      previousTokens = metrics.estimatedTokens;
      const usageRatio = contextUsageRatio(metrics, input.contextWindow);
      if (!warned && usageRatio >= input.warningRatio) {
        warned = true;
        input.onWarning?.(usageRatio);
      }
      const reason = compactionReason(metrics, input, compactedIteration);
      const tools = terminalTools(context, input);
      if (!reason || !input.compact || context.request.messages.length < 2)
        return tools ? { tools } : undefined;
      const messages = await input.compact(metrics, reason);
      compactedIteration = metrics.iteration;
      previousTokens = estimatedMessagesTokens(messages);
      warned = false;
      input.onCompaction?.(metrics, reason);
      return { messages, ...(tools ? { tools } : {}) };
    },
  };
}

function terminalTools(
  context: BeforeModelContext,
  input: Parameters<typeof contextPressureHooks>[0],
) {
  if (
    input.terminalIteration === undefined ||
    context.snapshot.iteration < input.terminalIteration
  )
    return undefined;
  const names = new Set(input.terminalToolNames ?? []);
  return context.request.tools.filter((tool: { name: string }) =>
    names.has(tool.name),
  );
}

function pressureMetrics(
  context: BeforeModelContext,
  previousTokens: number,
): ContextPressureMetrics {
  const estimatedTokens = estimatedRequestTokens(context.request);
  const toolResults = toolResultPayloads(context.request.messages);
  const oldToolResults = toolResults.slice(0, -4);
  return {
    estimatedTokens,
    iteration: context.snapshot.iteration,
    marginalTokens: Math.max(0, estimatedTokens - previousTokens),
    noveltyRatio: noveltyRatio(toolResults),
    oldToolResultTokens: estimatedValuesTokens(oldToolResults),
    toolResultCount: toolResults.length,
  };
}

function compactionReason(
  metrics: ContextPressureMetrics,
  input: Parameters<typeof contextPressureHooks>[0],
  compactedIteration: number,
) {
  if (metrics.iteration - compactedIteration < 4) return undefined;
  if (
    input.checkpointIteration !== undefined &&
    metrics.iteration >= input.checkpointIteration &&
    compactedIteration < input.checkpointIteration
  )
    return "iteration_checkpoint";
  if (metrics.estimatedTokens >= (input.maximumContextTokens ?? 96_000))
    return "absolute_context";
  if (
    metrics.oldToolResultTokens >= (input.maximumOldToolResultTokens ?? 32_000)
  )
    return "old_tool_results";
  if (lowNoveltyPressure(metrics, input)) return "low_novelty";
  if (marginalPressure(metrics, input)) return "marginal_iteration_cost";
  return undefined;
}

function lowNoveltyPressure(
  metrics: ContextPressureMetrics,
  input: Parameters<typeof contextPressureHooks>[0],
) {
  return (
    metrics.toolResultCount >= 8 &&
    metrics.oldToolResultTokens >= 8_000 &&
    metrics.noveltyRatio <= (input.minimumNoveltyRatio ?? 0.25)
  );
}

function marginalPressure(
  metrics: ContextPressureMetrics,
  input: Parameters<typeof contextPressureHooks>[0],
) {
  return (
    metrics.estimatedTokens >= (input.maximumContextTokens ?? 96_000) / 2 &&
    metrics.marginalTokens >= (input.marginalTokenThreshold ?? 12_000)
  );
}

function toolResultPayloads(messages: AgentMessages) {
  return messages.flatMap((message: AgentMessage) =>
    message.content.flatMap((part: AgentMessagePart) =>
      part.type === "tool-result" ? [part.output] : [],
    ),
  );
}

function noveltyRatio(values: unknown[]) {
  if (!values.length) return 1;
  const signatures = new Set(
    values.map((value) => JSON.stringify(value)?.slice(0, 2_000) ?? ""),
  );
  return signatures.size / values.length;
}

function contextUsageRatio(
  metrics: ContextPressureMetrics,
  contextWindow?: number,
) {
  return contextWindow ? metrics.estimatedTokens / contextWindow : 0;
}

function estimatedRequestTokens(request: BeforeModelContext["request"]) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(request), "utf8") / 4);
}

function estimatedMessagesTokens(messages: AgentMessages) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(messages), "utf8") / 4);
}

function estimatedValuesTokens(values: unknown[]) {
  return Math.ceil(Buffer.byteLength(JSON.stringify(values), "utf8") / 4);
}
