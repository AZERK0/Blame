import type { CoreSessionConfig } from "@cline/sdk";
import { createMcpTools } from "@cline/sdk";

type AgentTool = NonNullable<CoreSessionConfig["extraTools"]>[number];
type ToolContext = Parameters<AgentTool["execute"]>[1];

export type PreviewDevtoolsTarget = {
  available: boolean;
  browserUrl: string;
  currentUrl?: string;
  error?: string;
  id?: string;
  lifecycle?: unknown;
  loading: boolean;
  message: string;
  reason: string;
  scope?: string;
  status: "failed" | "ready" | "starting" | "stopped" | "unavailable";
  mcpServer: {
    args: string[];
    command: string;
    name: string;
  };
};

export type PreviewRuntimeContext = {
  scope?: string;
  storyId?: string;
  workspaceMode?: "local-container" | "cloud-mirror";
  worktree: string;
};

type PreviewDevtoolsToolDescriptor = {
  description?: string;
  inputSchema: Record<string, unknown>;
  name: string;
};

type PreviewDevtoolsTargetInput = PreviewRuntimeContext & {
  signal?: AbortSignal;
  waitFor: "none" | "ready";
};

type PreviewDevtoolsProviderInput = PreviewRuntimeContext & {
  signal?: AbortSignal;
};

type PreviewDevtoolsCallInput = PreviewDevtoolsProviderInput & {
  arguments?: Record<string, unknown>;
  toolName: string;
};

type PreviewContainerLogsInput = PreviewRuntimeContext & {
  service?: string;
  signal?: AbortSignal;
  tailLines?: number;
};

export type PreviewToolRuntimeOptions = {
  previewContainerLogs?(
    input: PreviewContainerLogsInput,
  ): Promise<unknown> | unknown;
  previewDevtools?(
    input: PreviewDevtoolsTargetInput,
  ):
    | Promise<PreviewDevtoolsTarget | undefined>
    | PreviewDevtoolsTarget
    | undefined;
  previewDevtoolsCall?(
    input: PreviewDevtoolsCallInput,
  ): Promise<unknown> | unknown;
  previewDevtoolsTools?(
    input: PreviewDevtoolsProviderInput,
  ):
    | Promise<readonly PreviewDevtoolsToolDescriptor[]>
    | readonly PreviewDevtoolsToolDescriptor[];
};

type PreviewToolsLogger = {
  log(message: string, payload?: Record<string, unknown>): void;
};

type PreviewSessionContextInput = {
  previewDevtoolsScope?: string;
  storyId?: string;
  workspaceMode?: "local-container" | "cloud-mirror";
  workspaceRoot: string;
};

export function previewRuntimeContext(
  input: PreviewSessionContextInput,
): PreviewRuntimeContext {
  return {
    ...(input.previewDevtoolsScope
      ? { scope: input.previewDevtoolsScope }
      : {}),
    ...(input.storyId ? { storyId: input.storyId } : {}),
    ...(input.workspaceMode ? { workspaceMode: input.workspaceMode } : {}),
    worktree: input.workspaceRoot,
  };
}

export async function previewDevtoolsMcpTools(
  options: PreviewToolRuntimeOptions,
  preview: PreviewRuntimeContext,
  logger: PreviewToolsLogger,
): Promise<AgentTool[]> {
  if (!preview.scope || !mcpAvailable(options)) return [];
  try {
    return await createMcpTools({
      maxRetries: 0,
      nameTransform: ({ toolName }: { toolName: string }) =>
        `preview_devtools__${toolName}`,
      provider: previewMcpProvider(options, preview),
      retryable: false,
      serverName: "preview-devtools",
      timeoutMs: 300_000,
    });
  } catch (error) {
    logger.log("Preview DevTools MCP tools unavailable", {
      error: errorMessage(error),
    });
    return [];
  }
}

function mcpAvailable(options: PreviewToolRuntimeOptions) {
  return Boolean(options.previewDevtoolsCall && options.previewDevtoolsTools);
}

function previewMcpProvider(
  options: PreviewToolRuntimeOptions,
  preview: PreviewRuntimeContext,
) {
  return {
    async listTools() {
      return options.previewDevtoolsTools!(preview);
    },
    async callTool(request: {
      arguments?: Record<string, unknown>;
      context?: ToolContext;
      toolName: string;
    }) {
      return options.previewDevtoolsCall!({
        ...preview,
        arguments: request.arguments,
        signal: request.context?.signal,
        toolName: request.toolName,
      });
    },
  };
}

export function previewDevtoolsTool(
  options: PreviewToolRuntimeOptions,
  preview: PreviewRuntimeContext | undefined,
): AgentTool | undefined {
  if (!options.previewDevtools || !preview) return undefined;
  return {
    name: "get_preview_devtools",
    description:
      "Inspect the real lifecycle of this session's Blame preview. Choose an immediate state snapshot or wait only while a preview is actively starting. Stopped, failed, and unopened browser states always return immediately. When ready, use the preview_devtools__* tools directly.",
    inputSchema: previewDevtoolsInputSchema(),
    execute: (input: unknown, context: ToolContext) =>
      executePreviewDevtoolsTool(options, preview, input, context.signal),
  };
}

function previewDevtoolsInputSchema() {
  return {
    type: "object",
    properties: {
      waitFor: {
        type: "string",
        enum: ["none", "ready"],
        default: "none",
        description:
          "Use none to return the current state immediately. Use ready to wait while the preview is actively starting; stopped or failed states still return immediately.",
      },
    },
    additionalProperties: false,
  };
}

async function executePreviewDevtoolsTool(
  options: PreviewToolRuntimeOptions,
  preview: PreviewRuntimeContext,
  input: unknown,
  signal?: AbortSignal,
) {
  const target = await options.previewDevtools?.(
    previewDevtoolsInput(input, preview, signal),
  );
  if (!target) throw new Error("Preview state is unavailable.");
  return {
    ...target,
    recommendation: previewDevtoolsRecommendation(target.status),
    usage: target.available
      ? "Use the preview_devtools__* tools directly; Blame scopes every call to this preview page."
      : undefined,
  };
}

function previewDevtoolsInput(
  input: unknown,
  preview: PreviewRuntimeContext,
  signal?: AbortSignal,
): PreviewDevtoolsTargetInput {
  return {
    ...preview,
    signal,
    waitFor: recordValue(input).waitFor === "ready" ? "ready" : "none",
  };
}

function previewDevtoolsRecommendation(
  status: PreviewDevtoolsTarget["status"],
) {
  if (status === "starting") {
    return "Call again with waitFor=ready only if blocking for startup is useful; otherwise continue other work.";
  }
  if (status === "stopped") return "Start the preview before using DevTools.";
  if (status === "failed") {
    return "Inspect preview logs or repair the preview failure.";
  }
  if (status === "unavailable") {
    return "Open the integrated preview browser before using DevTools.";
  }
  return "Use the scoped preview_devtools__* tools for browser verification.";
}

export function previewContainerLogsTool(
  options: PreviewToolRuntimeOptions,
  preview?: PreviewRuntimeContext,
): AgentTool | undefined {
  if (!options.previewContainerLogs || !preview) return undefined;
  return {
    name: "get_preview_container_logs",
    description:
      "Get state-aware logs for this session's Blame preview. Stopped previews return immediately without a container query. Local previews return available compose services, recent stdout and stderr, or the archived setup log; managed previews identify the live log stream. Defaults to the first preview service and 120 tail lines.",
    inputSchema: previewContainerLogsInputSchema(),
    execute: (input: unknown, context: ToolContext) =>
      executePreviewContainerLogs(options, preview, input, context.signal),
  };
}

async function executePreviewContainerLogs(
  options: PreviewToolRuntimeOptions,
  preview: PreviewRuntimeContext,
  input: unknown,
  signal?: AbortSignal,
) {
  try {
    return await options.previewContainerLogs?.({
      ...preview,
      ...previewContainerLogsInput(input),
      signal,
    });
  } catch (error) {
    return {
      outcome: "failed",
      reason: "PREVIEW_LOG_READ_FAILED",
      recommendation:
        "Continue with local validation. Retry logs only after preview state changes.",
      isError: true,
      output: { error: errorMessage(error) },
    };
  }
}

function previewContainerLogsInputSchema() {
  return {
    type: "object",
    properties: {
      service: {
        type: "string",
        description:
          "Optional compose service name to read logs for. When omitted, Blame selects the first preview service, matching the preview drawer.",
      },
      tailLines: {
        type: "number",
        description:
          "Maximum number of recent log lines to return from live containers. Defaults to 120 and is capped at 1000.",
      },
    },
    additionalProperties: false,
  };
}

function previewContainerLogsInput(input: unknown) {
  const record = recordValue(input);
  const service = stringValue(record.service);
  return {
    ...(service ? { service } : {}),
    tailLines: boundedNumber(record.tailLines, 1, 1000) ?? 120,
  };
}

function recordValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(Math.max(Math.trunc(value), minimum), maximum);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
