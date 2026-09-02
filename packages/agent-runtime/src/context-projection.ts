import { createHash } from "node:crypto";
import type {
  AgentPlugin,
  ContentBlock,
  Message,
  ToolResultContent,
  ToolUseContent,
} from "@cline/sdk";

type ContextExtensionApi = Parameters<NonNullable<AgentPlugin["setup"]>>[0];

export type ContextProjectionMetrics = {
  categories: Record<string, number>;
  composedBytes: number;
  duplicateBytes: number;
  messageBytes: number;
  originalMessageBytes: number;
  projectedBytesSaved: number;
  requestIndex: number;
  staleReadsReplaced: number;
  successfulEditsReplaced: number;
  systemPromptBytes: number;
  toolDefinitionBytes: number;
  transcriptHash: string;
};

type ContextProjectionOptions = {
  emit(metrics: ContextProjectionMetrics): void;
  systemPrompt: string;
  tools: unknown[];
};

type ProjectionStats = {
  staleReadsReplaced: number;
  successfulEditsReplaced: number;
};

type IndexedTool = {
  input: Record<string, unknown>;
  name: string;
  result?: Record<string, unknown>;
  resultIndex?: number;
};

type LatestEdit = {
  id: string;
  index: number;
  revision?: string;
};

type IndexedRead = {
  path: string;
  receipt?: string;
};

type HistoryIndex = {
  latestEditByPath: Map<string, LatestEdit>;
  latestReadIndexByPath: Map<string, number>;
  readById: Map<string, IndexedRead>;
  successfulEditIds: Set<string>;
  tools: Map<string, IndexedTool>;
};

export function createContextProjectionExtension(
  options: ContextProjectionOptions,
): AgentPlugin {
  let requestIndex = 0;
  return {
    name: "blame-context-projection",
    manifest: { capabilities: ["messageBuilders"] },
    setup(api: ContextExtensionApi) {
      api.registerMessageBuilder({
        name: "blame-provider-context-projection",
        build(messages: Message[]) {
          const projection = projectProviderContext(
            messages,
            options,
            requestIndex + 1,
          );
          if (!providerReadyMessages(messages)) return projection.messages;
          requestIndex += 1;
          options.emit(projection.metrics);
          return projection.messages;
        },
      });
    },
  };
}

export function projectProviderContext(
  messages: Message[],
  options: Pick<ContextProjectionOptions, "systemPrompt" | "tools">,
  requestIndex = 1,
) {
  const history = indexHistory(messages);
  const stats = emptyProjectionStats();
  const projected = messages.map((message, index) =>
    projectMessage(message, index, history, stats),
  );
  return {
    messages: projected,
    metrics: contextMetrics(messages, projected, options, stats, requestIndex),
  };
}

function indexHistory(messages: Message[]): HistoryIndex {
  const history = emptyHistoryIndex();
  messages.forEach((message, index) => indexMessage(message, index, history));
  finalizeHistoryIndex(history);
  return history;
}

function indexMessage(message: Message, index: number, history: HistoryIndex) {
  if (!Array.isArray(message.content)) return;
  for (const block of message.content) {
    if (block.type === "tool_use") indexToolUse(block, history);
    if (block.type === "tool_result") indexToolResult(block, index, history);
  }
}

function indexToolUse(block: ToolUseContent, history: HistoryIndex) {
  history.tools.set(block.id, { input: block.input, name: block.name });
}

function indexToolResult(
  block: ToolResultContent,
  index: number,
  history: HistoryIndex,
) {
  const tool = history.tools.get(block.tool_use_id);
  if (!tool) return;
  tool.result = parseToolResult(block);
  tool.resultIndex = index;
}

function finalizeHistoryIndex(history: HistoryIndex) {
  for (const [id, tool] of history.tools) {
    if (tool.name === "read_code") indexRead(id, tool, history);
    if (tool.name !== "edit_code" || !successfulResult(tool.result)) continue;
    history.successfulEditIds.add(id);
    indexEdit(id, tool, history);
  }
}

function indexRead(id: string, tool: IndexedTool, history: HistoryIndex) {
  const data = recordValue(tool.result?.data);
  const path = stringValue(data?.path) ?? stringValue(tool.input.target);
  if (!path) return;
  const resultIndex = tool.resultIndex ?? -1;
  history.readById.set(id, {
    path,
    receipt: stringValue(tool.result?.receipt),
  });
  history.latestReadIndexByPath.set(path, resultIndex);
}

function indexEdit(id: string, tool: IndexedTool, history: HistoryIndex) {
  const data = recordValue(tool.result?.data);
  const revision = stringValue(data?.sourceRevisionId);
  const index = tool.resultIndex ?? -1;
  for (const change of arrayValue(data?.changes).map(recordValue)) {
    const path = stringValue(change?.path);
    if (path) history.latestEditByPath.set(path, { id, index, revision });
  }
}

function projectMessage(
  message: Message,
  index: number,
  history: HistoryIndex,
  stats: ProjectionStats,
): Message {
  if (!Array.isArray(message.content)) return message;
  const source = message.content as ContentBlock[];
  const content = source.map((block: ContentBlock) =>
    projectBlock(block, index, history, stats),
  );
  return content.every((block, blockIndex) => block === source[blockIndex])
    ? message
    : { ...message, content };
}

function projectBlock(
  block: ContentBlock,
  index: number,
  history: HistoryIndex,
  stats: ProjectionStats,
): ContentBlock {
  if (block.type === "tool_use") return projectToolUse(block, history, stats);
  if (block.type !== "tool_result") return block;
  const read = history.readById.get(block.tool_use_id);
  const edit = read ? history.latestEditByPath.get(read.path) : undefined;
  const latestReadIndex = read
    ? history.latestReadIndexByPath.get(read.path)
    : undefined;
  if (!read || !supersededRead(index, edit, latestReadIndex)) return block;
  stats.staleReadsReplaced += 1;
  return supersededReadResult(block, read, edit?.revision);
}

function supersededRead(
  readIndex: number,
  edit: LatestEdit | undefined,
  latestReadIndex: number | undefined,
) {
  return Boolean(
    edit &&
      edit.index > readIndex &&
      latestReadIndex !== undefined &&
      latestReadIndex > edit.index,
  );
}

function projectToolUse(
  block: ToolUseContent,
  history: HistoryIndex,
  stats: ProjectionStats,
): ToolUseContent {
  if (!history.successfulEditIds.has(block.id)) return block;
  if (unobservedCurrentEdit(block.id, history)) return block;
  stats.successfulEditsReplaced += 1;
  const tool = history.tools.get(block.id);
  return { ...block, input: compactEditInput(tool) };
}

function unobservedCurrentEdit(id: string, history: HistoryIndex) {
  const tool = history.tools.get(id);
  const paths = changedPaths(tool);
  return paths.some((path) => {
    const edit = history.latestEditByPath.get(path);
    const readIndex = history.latestReadIndexByPath.get(path);
    return edit?.id === id && (readIndex === undefined || readIndex <= edit.index);
  });
}

function changedPaths(tool: IndexedTool | undefined) {
  const data = recordValue(tool?.result?.data);
  return arrayValue(data?.changes)
    .map(recordValue)
    .flatMap((change) => {
      const path = stringValue(change?.path);
      return path ? [path] : [];
    });
}

function compactEditInput(tool: IndexedTool | undefined) {
  const data = recordValue(tool?.result?.data);
  return {
    acknowledged: true,
    changedPaths: changedPaths(tool),
    receipt: stringValue(tool?.result?.receipt),
    sourceRevisionId: stringValue(data?.sourceRevisionId),
  };
}

function supersededReadResult(
  block: ToolResultContent,
  read: IndexedRead,
  revision?: string,
): ToolResultContent {
  return {
    ...block,
    content: JSON.stringify({
      data: {
        latestRevision: revision,
        path: read.path,
        receipt: read.receipt,
      },
      status: "superseded_after_edit",
    }),
  };
}

function contextMetrics(
  original: Message[],
  projected: Message[],
  options: Pick<ContextProjectionOptions, "systemPrompt" | "tools">,
  stats: ProjectionStats,
  requestIndex: number,
): ContextProjectionMetrics {
  const originalMessageBytes = serializedBytes(original);
  const messageBytes = serializedBytes(projected);
  const systemPromptBytes = utf8Bytes(options.systemPrompt);
  const toolDefinitionBytes = serializedBytes(
    options.tools.map(measurableToolDefinition),
  );
  return {
    categories: contextCategories(projected),
    composedBytes: messageBytes + systemPromptBytes + toolDefinitionBytes,
    duplicateBytes: duplicateContentBytes(projected),
    messageBytes,
    originalMessageBytes,
    projectedBytesSaved: originalMessageBytes - messageBytes,
    requestIndex,
    staleReadsReplaced: stats.staleReadsReplaced,
    successfulEditsReplaced: stats.successfulEditsReplaced,
    systemPromptBytes,
    toolDefinitionBytes,
    transcriptHash: hashValue(projected),
  };
}

function contextCategories(messages: Message[]) {
  const categories: Record<string, number> = {};
  const toolNames = toolNamesById(messages);
  for (const message of messages) {
    if (typeof message.content === "string")
      addCategory(categories, `${message.role}_text`, utf8Bytes(message.content));
    else
      for (const block of message.content)
        addCategory(
          categories,
          blockCategory(block, toolNames, message.role),
          serializedBytes(block),
        );
  }
  return categories;
}

function blockCategory(
  block: ContentBlock,
  toolNames: Map<string, string>,
  role: Message["role"],
) {
  if (block.type === "tool_use") return `tool_input.${block.name}`;
  if (block.type === "tool_result")
    return `tool_result.${toolNames.get(block.tool_use_id) ?? block.name}`;
  if (block.type === "thinking" || block.type === "redacted_thinking")
    return "assistant_reasoning";
  if (block.type === "text") return `${role}_text`;
  return "attachment";
}

function toolNamesById(messages: Message[]) {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content)
      if (block.type === "tool_use") names.set(block.id, block.name);
  }
  return names;
}

function duplicateContentBytes(messages: Message[]) {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const value of contentValues(messages)) {
    const bytes = serializedBytes(value);
    if (bytes < 32) continue;
    const hash = hashValue(value);
    if (seen.has(hash)) duplicates += bytes;
    else seen.add(hash);
  }
  return duplicates;
}

function contentValues(messages: Message[]): unknown[] {
  return messages.flatMap<unknown>((message) =>
    typeof message.content === "string"
      ? [message.content]
      : [...message.content],
  );
}

function parseToolResult(block: ToolResultContent) {
  const text =
    typeof block.content === "string"
      ? block.content
      : block.content
          .flatMap((entry: ContentBlock) =>
            entry.type === "text" ? [entry.text] : [],
          )
          .join("\n");
  try {
    return recordValue(JSON.parse(text));
  } catch {
    return undefined;
  }
}

function successfulResult(result: Record<string, unknown> | undefined) {
  return result?.status === "ok";
}

function emptyHistoryIndex(): HistoryIndex {
  return {
    latestEditByPath: new Map(),
    latestReadIndexByPath: new Map(),
    readById: new Map(),
    successfulEditIds: new Set(),
    tools: new Map(),
  };
}

function emptyProjectionStats(): ProjectionStats {
  return { staleReadsReplaced: 0, successfulEditsReplaced: 0 };
}

function addCategory(
  categories: Record<string, number>,
  category: string,
  bytes: number,
) {
  categories[category] = (categories[category] ?? 0) + bytes;
}

function hashValue(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function serializedBytes(value: unknown) {
  const serialized = JSON.stringify(value);
  return serialized ? utf8Bytes(serialized) : 0;
}

function utf8Bytes(value: string) {
  return Buffer.byteLength(value, "utf8");
}

function recordValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function measurableToolDefinition(value: unknown) {
  const tool = recordValue(value);
  return {
    description: stringValue(tool?.description),
    inputSchema: tool?.inputSchema,
    name: stringValue(tool?.name),
  };
}

function providerReadyMessages(messages: Message[]) {
  return messages.every((message) =>
    Object.keys(message).every((key) => key === "content" || key === "role"),
  );
}
