import type {
  AgentPlugin,
  ContentBlock,
  CoreCompactionConfig,
  Message,
} from "@cline/sdk";
import type { ModelInfo } from "@cline/llms";
import type { ConversationMemoryStore } from "./conversation-memory.js";
import type { TokenCounter } from "./conversation-memory.js";
import { renderRuntimeContinuity } from "./runtime-continuity.js";
import { sha256 } from "./protocol.js";

type ProjectionMode = "normal" | "overflow";
type PluginSetup = NonNullable<AgentPlugin["setup"]>;
type Compact = NonNullable<CoreCompactionConfig["compact"]>;

export type BlameCompactionMetrics = {
  capsuleHash: string;
  compactedEventHashes: string[];
  mode: ProjectionMode;
  tailMessages: number;
  tokensAfter: number;
  tokensBefore: number;
};

export type BlameCompactionOptions = {
  memory: ConversationMemoryStore;
  model: ModelInfo;
  systemPrompt: string;
  tools: unknown[];
  maxOutputTokens?: number;
  warningRatio?: number;
  triggerRatio?: number;
  targetRatio?: number;
  tokenCounter?: TokenCounter;
  overflowTargetRatio?: number;
  beforeProjection?(): Promise<void>;
  onWarning?(usageRatio: number): void;
  onCompaction?(metrics: BlameCompactionMetrics): void;
};

export type BlameCompactionController = {
  extension: AgentPlugin;
  overflowRecovery: NonNullable<CoreCompactionConfig["compact"]>;
};

type ProjectionState = {
  overflowAttempts: number;
  warned: boolean;
};

type MessageUnit = {
  messages: Message[];
  tokens: number;
};

export function createBlameCompaction(
  options: BlameCompactionOptions,
): BlameCompactionController {
  const state: ProjectionState = { overflowAttempts: 0, warned: false };
  const extension: AgentPlugin = {
    name: "blame-deterministic-compaction",
    manifest: { capabilities: ["messageBuilders"] },
    setup(api: Parameters<PluginSetup>[0]) {
      api.registerMessageBuilder({
        name: "blame-canonical-journal-projection",
        build: (messages: Message[]) =>
          projectMessages(messages, options, state, "normal"),
      });
    },
  };
  return {
    extension,
    overflowRecovery: async (context: Parameters<Compact>[0]) => {
      if (context.mode !== "overflow_recovery") return undefined;
      const messages = await projectMessages(
        context.messages,
        options,
        state,
        "overflow",
      );
      return {
        messages,
        budget: {
          policyIntent: "basic_compaction_projection",
          actionCount: 1,
          warningCount: 0,
          liveTailHandling: "included_verbatim",
        },
      };
    },
  };
}

export async function projectMessages(
  messages: Message[],
  options: BlameCompactionOptions,
  state: ProjectionState = { overflowAttempts: 0, warned: false },
  mode: ProjectionMode = "normal",
) {
  const budget = projectionBudget(options, state, mode);
  const tokensBefore = requestTokens(messages, options);
  warnForPressure(tokensBefore, budget.maximum, options, state);
  if (mode === "normal" && tokensBefore < budget.trigger) return messages;
  await options.beforeProjection?.();
  const continuity = await options.memory.runtimeContinuity();
  const capsule = renderRuntimeContinuity(continuity);
  const projected = buildProjection(
    messages,
    continuity.activeRequest,
    capsule,
    budget.target,
    options,
  );
  const tokensAfter = requestTokens(projected.messages, options);
  state.overflowAttempts = mode === "overflow" ? state.overflowAttempts + 1 : 0;
  options.onCompaction?.({
    capsuleHash: sha256(capsule),
    compactedEventHashes: projected.compacted.map(messageHash),
    mode,
    tailMessages: projected.tailMessages,
    tokensAfter,
    tokensBefore,
  });
  return projected.messages;
}

function buildProjection(
  messages: Message[],
  activeRequest: string,
  capsule: string,
  targetTokens: number,
  options: BlameCompactionOptions,
) {
  const firstUserIndex = messages.findIndex(({ role }) => role === "user");
  if (firstUserIndex < 0) return unchangedProjection(messages);
  const activeIndex = activeRequestIndex(
    messages,
    activeRequest,
    firstUserIndex,
  );
  const prefix = messages.slice(0, firstUserIndex);
  const request = compactedRequestMessage(
    messages[activeIndex]!,
    activeRequest,
    capsule,
  );
  const fixedTokens = requestTokens([...prefix, request], options);
  const units = messageUnits(messages.slice(activeIndex + 1), options);
  const selected = selectRecentUnits(
    units,
    Math.max(0, targetTokens - fixedTokens),
  );
  const recent = selected.flatMap(({ messages: unitMessages }) => unitMessages);
  const retained = new Set(recent);
  return {
    messages: [...prefix, request, ...recent],
    compacted: messages
      .slice(firstUserIndex)
      .filter(
        (message) =>
          !retained.has(message) && message !== messages[activeIndex],
      ),
    tailMessages: recent.length,
  };
}

function compactedRequestMessage(
  source: Message,
  activeRequest: string,
  capsule: string,
): Message {
  const attachments = messageBlocks(source).filter(
    ({ type }) => type !== "text" && type !== "tool_result",
  );
  return {
    ...source,
    role: "user",
    content: [
      { type: "text", text: activeRequest },
      { type: "text", text: capsule },
      ...attachments,
    ],
  };
}

function messageUnits(messages: Message[], options: BlameCompactionOptions) {
  const units: MessageUnit[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const unit = [message];
    if (message.role === "assistant" && toolUseIds(message).size) {
      index = appendToolResults(messages, index, unit, toolUseIds(message));
      index = appendTextClosure(messages, index, unit);
    }
    units.push({ messages: unit, tokens: estimateTokens(unit, options) });
  }
  return units;
}

function appendToolResults(
  messages: Message[],
  start: number,
  unit: Message[],
  pending: Set<string>,
) {
  let index = start;
  while (pending.size && index + 1 < messages.length) {
    const candidate = messages[index + 1]!;
    const resultIds = toolResultIds(candidate);
    if (![...resultIds].some((id) => pending.has(id))) break;
    unit.push(candidate);
    resultIds.forEach((id) => pending.delete(id));
    index += 1;
  }
  return index;
}

function appendTextClosure(
  messages: Message[],
  index: number,
  unit: Message[],
) {
  const candidate = messages[index + 1];
  if (!candidate || candidate.role !== "assistant") return index;
  if (toolUseIds(candidate).size || !messageText(candidate).trim())
    return index;
  unit.push(candidate);
  return index + 1;
}

function selectRecentUnits(units: MessageUnit[], targetTokens: number) {
  const selected: MessageUnit[] = [];
  let tokens = 0;
  for (let index = units.length - 1; index >= 0; index -= 1) {
    const unit = units[index]!;
    if (tokens + unit.tokens > targetTokens) break;
    selected.unshift(unit);
    tokens += unit.tokens;
  }
  return selected;
}

function projectionBudget(
  options: BlameCompactionOptions,
  state: ProjectionState,
  mode: ProjectionMode,
) {
  const maximum = effectiveInputTokens(options);
  const targetRatio =
    mode === "overflow"
      ? Math.max(
          0.2,
          (options.overflowTargetRatio ?? 0.35) - state.overflowAttempts * 0.05,
        )
      : (options.targetRatio ?? 0.4);
  return {
    maximum,
    trigger: Math.floor(maximum * (options.triggerRatio ?? 0.7)),
    target: Math.floor(maximum * targetRatio),
  };
}

function effectiveInputTokens(options: BlameCompactionOptions) {
  const reserved = options.maxOutputTokens ?? options.model.maxTokens ?? 8_192;
  const contextInput = options.model.contextWindow
    ? Math.max(1, options.model.contextWindow - reserved)
    : Number.POSITIVE_INFINITY;
  return Math.min(options.model.maxInputTokens ?? contextInput, contextInput);
}

function requestTokens(messages: Message[], options: BlameCompactionOptions) {
  return estimateTokens(
    [options.systemPrompt, options.tools, messages, { providerFraming: true }],
    options,
  );
}

function warnForPressure(
  tokens: number,
  maximum: number,
  options: BlameCompactionOptions,
  state: ProjectionState,
) {
  const ratio = tokens / maximum;
  if (state.warned || ratio < (options.warningRatio ?? 0.55)) return;
  state.warned = true;
  options.onWarning?.(ratio);
}

function activeRequestIndex(
  messages: Message[],
  activeRequest: string,
  fallback: number,
) {
  const index = findLastMessageIndex(
    messages,
    (message) =>
      message.role === "user" && messageText(message).includes(activeRequest),
  );
  if (index >= 0) return index;
  const latest = findLastMessageIndex(
    messages,
    (message) => message.role === "user" && !toolResultIds(message).size,
  );
  return latest >= 0 ? latest : fallback;
}

function findLastMessageIndex(
  messages: Message[],
  predicate: (message: Message) => boolean,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1)
    if (predicate(messages[index]!)) return index;
  return -1;
}

function messageBlocks(message: Message): ContentBlock[] {
  return typeof message.content === "string"
    ? [{ type: "text" as const, text: message.content }]
    : message.content;
}

function messageText(message: Message) {
  return messageBlocks(message)
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n");
}

function toolUseIds(message: Message) {
  return new Set(
    messageBlocks(message).flatMap((block) =>
      block.type === "tool_use" ? [block.id] : [],
    ),
  );
}

function toolResultIds(message: Message) {
  return new Set(
    messageBlocks(message).flatMap((block) =>
      block.type === "tool_result" ? [block.tool_use_id] : [],
    ),
  );
}

function estimateTokens(value: unknown, options: BlameCompactionOptions) {
  const serialized = JSON.stringify(value);
  return (
    options.tokenCounter?.count(serialized) ??
    Math.ceil(Buffer.byteLength(serialized, "utf8") / 4)
  );
}

function messageHash(message: Message) {
  return sha256(JSON.stringify(message));
}

function unchangedProjection(messages: Message[]) {
  return {
    messages,
    compacted: [] as Message[],
    tailMessages: messages.length,
  };
}
