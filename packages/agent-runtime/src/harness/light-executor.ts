import type { AgentToolContext } from "@cline/sdk";
import { createInitialTaskBriefing } from "./initial-task-briefing.js";
import type {
  LightEditCodeInput,
  LightReadCodeInput,
  LightRunTaskInput,
  LightSearchCodeInput,
  LightTaskContract,
  LightToolResult,
} from "./light-contracts.js";
import { executeLocalFinishTask } from "./light-finish-service.js";
import { LightWorkspace } from "./light-workspace.js";

export const lightWorkspaceToolNames = [
  "search_code",
  "read_code",
  "edit_code",
  "run_task",
  "finish_task",
  "initial_task_briefing",
] as const;

export type LightWorkspaceToolName = (typeof lightWorkspaceToolNames)[number];

export type LightWorkspaceExecutionRequest = {
  execution?: {
    backendMode?: "auto" | "local" | "hub" | "remote";
    workspaceMode?: "local-container" | "cloud-mirror";
  };
  input: unknown;
  taskContract?: LightTaskContract;
  tool: LightWorkspaceToolName;
  toolContext?: LightToolContext;
  workspaceRoot: string;
};

export type LightToolContext = {
  agentId?: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
  sessionId?: string;
  snapshot?: unknown;
  toolCallId?: string;
};

export type LightWorkspaceExecutor = (
  request: LightWorkspaceExecutionRequest,
  signal?: AbortSignal,
) => Promise<LightToolResult<unknown>>;

export function lightToolContext(
  context: Partial<AgentToolContext> | undefined,
): LightToolContext {
  if (!context) return {};
  return {
    ...(context.agentId ? { agentId: context.agentId } : {}),
    ...(context.conversationId
      ? { conversationId: context.conversationId }
      : {}),
    ...(context.metadata && typeof context.metadata === "object"
      ? { metadata: context.metadata as Record<string, unknown> }
      : {}),
    ...(context.sessionId ? { sessionId: context.sessionId } : {}),
    ...(context.snapshot ? { snapshot: context.snapshot } : {}),
    ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
  };
}

export function managedLightWorkspaceExecutor(
  executor: LightWorkspaceExecutor | undefined,
  execution: LightWorkspaceExecutionRequest["execution"],
) {
  if (
    !executor ||
    execution?.workspaceMode !== "local-container" ||
    execution.backendMode !== "remote"
  )
    return undefined;
  return (request: LightWorkspaceExecutionRequest, signal?: AbortSignal) =>
    executor({ ...request, execution }, signal);
}

export function localLightWorkspaceExecutor(
  workspaceRoot: string,
  taskContract?: LightTaskContract,
): LightWorkspaceExecutor {
  const workspace = new LightWorkspace(workspaceRoot, {
    sessionId: taskContract?.session_id ?? "unscoped-session",
    taskContract,
  });
  return (request, signal) => executeWithWorkspace(workspace, request, signal);
}

export function executeLightWorkspaceRequest(
  request: LightWorkspaceExecutionRequest,
  signal?: AbortSignal,
) {
  return localLightWorkspaceExecutor(
    request.workspaceRoot,
    request.taskContract,
  )(request, signal);
}

async function executeWithWorkspace(
  workspace: LightWorkspace,
  request: LightWorkspaceExecutionRequest,
  signal?: AbortSignal,
): Promise<LightToolResult<unknown>> {
  const context = agentContext(request.toolContext, signal);
  switch (request.tool) {
    case "search_code":
      return workspace.searchCode(
        request.input as LightSearchCodeInput,
        signal,
      );
    case "read_code":
      return workspace.readCode(request.input as LightReadCodeInput, context);
    case "edit_code":
      return workspace.editCode(request.input as LightEditCodeInput, context);
    case "run_task":
      return workspace.runTask(request.input as LightRunTaskInput, context);
    case "finish_task":
      return finishRequest(request, context);
    case "initial_task_briefing":
      return briefingRequest(request);
  }
}

function finishRequest(
  request: LightWorkspaceExecutionRequest,
  context: AgentToolContext,
) {
  return executeLocalFinishTask({
    context,
    input: request.input,
    taskContract: request.taskContract,
    workspaceRoot: request.workspaceRoot,
  });
}

async function briefingRequest(request: LightWorkspaceExecutionRequest) {
  const briefing = await createInitialTaskBriefing({
    taskContract: request.taskContract,
    workspaceRoot: request.workspaceRoot,
  });
  return { status: "ok" as const, data: { briefing } };
}

function agentContext(
  context: LightToolContext | undefined,
  signal?: AbortSignal,
) {
  return { ...context, signal } as AgentToolContext;
}
