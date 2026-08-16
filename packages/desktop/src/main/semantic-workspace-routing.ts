import type { SemanticWorkspaceExecutionRequest } from "@blame/agent-runtime";
import { runtimeManagedPath } from "./workspace-runtime.ts";

export type SemanticWorkspaceExecutionTarget = "managed-runtime" | "native";

export function semanticWorkspaceExecutionTarget(
  request: SemanticWorkspaceExecutionRequest,
  platform: NodeJS.Platform = process.platform,
): SemanticWorkspaceExecutionTarget {
  return (platform === "darwin" || platform === "win32") &&
    request.execution?.workspaceMode === "local-container" &&
    request.execution.backendMode === "remote" &&
    runtimeManagedPath(request.workspaceRoot, platform)
    ? "managed-runtime"
    : "native";
}
