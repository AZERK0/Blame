import type { LightWorkspaceExecutionRequest } from "@blame/agent-runtime";
import { runtimeManagedPath } from "./workspace-runtime.ts";

export type LightWorkspaceExecutionTarget = "managed-runtime" | "native";

export function lightWorkspaceExecutionTarget(
  request: LightWorkspaceExecutionRequest,
  platform: NodeJS.Platform = process.platform,
): LightWorkspaceExecutionTarget {
  return (platform === "darwin" || platform === "win32") &&
    request.execution?.workspaceMode === "local-container" &&
    request.execution.backendMode === "remote" &&
    runtimeManagedPath(request.workspaceRoot, platform)
    ? "managed-runtime"
    : "native";
}
