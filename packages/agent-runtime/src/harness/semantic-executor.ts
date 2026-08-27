import type { HarnessToolResult } from "./protocol.js";
import { SemanticWorkspace } from "./semantic-workspace.js";

export const semanticWorkspaceReadToolNames = [
  "workspace_state",
  "search_code",
  "outline_code",
  "inspect_code",
  "get_relation_context",
  "recall_context",
  "inspect_run",
  "inspect_artifact",
  "review_change",
  "validate_change",
] as const;

export const semanticWorkspaceWriteToolNames = [
  "edit_symbol",
  "edit_json",
  "patch_file",
  "edit_files",
  "create_file",
  "replace_file",
  "delete_file",
  "move_file",
  "edit_code",
  "apply_change",
  "run_task",
  "mutate_dependencies",
] as const;

export type SemanticWorkspaceToolName =
  | (typeof semanticWorkspaceReadToolNames)[number]
  | (typeof semanticWorkspaceWriteToolNames)[number];

export type SemanticWorkspaceExecutionRequest = {
  execution?: {
    backendMode?: "auto" | "local" | "hub" | "remote";
    workspaceMode?: "local-container" | "cloud-mirror";
  };
  input: unknown;
  taskContract?: {
    session_id?: string;
    story_id?: string;
    objective?: string;
  };
  toolContext?: {
    contextEpoch?: string;
    sessionId?: string;
    toolCallId?: string;
  };
  tool: SemanticWorkspaceToolName;
  workspaceRoot: string;
};

export type SemanticWorkspaceExecutor = (
  request: SemanticWorkspaceExecutionRequest,
  signal?: AbortSignal,
) => Promise<HarnessToolResult<unknown>>;

export function managedSemanticWorkspaceExecutor(
  executor: SemanticWorkspaceExecutor | undefined,
  execution: SemanticWorkspaceExecutionRequest["execution"],
) {
  if (
    !executor ||
    execution?.workspaceMode !== "local-container" ||
    execution.backendMode !== "remote"
  ) {
    return undefined;
  }
  return (request: SemanticWorkspaceExecutionRequest, signal?: AbortSignal) =>
    executor({ ...request, execution }, signal);
}

export function localSemanticWorkspaceExecutor(
  workspaceRoot: string,
  taskContract?: SemanticWorkspaceExecutionRequest["taskContract"],
): SemanticWorkspaceExecutor {
  const workspace = new SemanticWorkspace(workspaceRoot, { taskContract });
  return (request, signal) =>
    executeSemanticWorkspaceTool(
      workspace,
      request.tool,
      request.input,
      signal,
      request.toolContext,
    );
}

export async function executeSemanticWorkspaceRequest(
  request: SemanticWorkspaceExecutionRequest,
  signal?: AbortSignal,
) {
  const workspace = new SemanticWorkspace(request.workspaceRoot, {
    taskContract: request.taskContract,
  });
  return executeSemanticWorkspaceTool(
    workspace,
    request.tool,
    request.input,
    signal,
    request.toolContext,
  );
}

async function executeSemanticWorkspaceTool(
  workspace: SemanticWorkspace,
  tool: SemanticWorkspaceToolName,
  input: unknown,
  signal?: AbortSignal,
  toolContext?: SemanticWorkspaceExecutionRequest["toolContext"],
): Promise<HarnessToolResult<unknown>> {
  switch (tool) {
    case "workspace_state":
      return workspace.workspaceState({
        ...recordInput(input),
        signal,
      });
    case "search_code":
      return workspace.searchCode(input as never, signal);
    case "outline_code":
      return workspace.outlineCode(input as never, signal);
    case "inspect_code":
      return workspace.inspectCode(input as never, signal, toolContext);
    case "get_relation_context":
      return workspace.getRelationContext(input as never, signal);
    case "recall_context":
      return workspace.recallContext(input as never);
    case "apply_change":
      return workspace.applyChange(input as never, signal);
    case "edit_code":
      return workspace.editCode(input as never, toolContext);
    case "edit_symbol":
      return workspace.editSymbol(input as never, toolContext);
    case "edit_json":
      return workspace.editJson(input as never, toolContext);
    case "patch_file":
      return workspace.patchFile(input as never, toolContext);
    case "edit_files":
      return workspace.editFiles(input as never, toolContext);
    case "create_file":
      return workspace.createFile(input as never, toolContext);
    case "replace_file":
      return workspace.replaceFile(input as never, toolContext);
    case "delete_file":
      return workspace.deleteFile(input as never, toolContext);
    case "move_file":
      return workspace.moveFile(input as never, toolContext);
    case "run_task":
      return workspace.runTask(input as never, signal, toolContext);
    case "mutate_dependencies":
      return workspace.mutateDependencies(input as never, signal);
    case "inspect_run":
      return workspace.inspectRun(input as never, signal);
    case "review_change":
      return workspace.reviewChange(input as never, signal);
    case "validate_change":
      return workspace.validateChange(input as never, signal);
    case "inspect_artifact":
      return workspace.inspectArtifact(input as never, signal);
    default:
      throw new Error(`Unsupported semantic workspace tool: ${String(tool)}`);
  }
}

function recordInput(input: unknown): Record<string, unknown> {
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {};
}
