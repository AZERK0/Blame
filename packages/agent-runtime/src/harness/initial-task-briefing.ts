import type {
  SemanticWorkspaceExecutionRequest,
  SemanticWorkspaceExecutor,
} from "./semantic-executor.js";
import { compactWorkspaceStateResult } from "./workspace-state-output.js";

type InitialTaskBriefingInput = {
  executor: SemanticWorkspaceExecutor;
  taskContract: SemanticWorkspaceExecutionRequest["taskContract"];
  workspaceRoot: string;
};

const initialTaskBriefingMaximumTokens = 1_200;

export async function createInitialTaskBriefing(
  input: InitialTaskBriefingInput,
) {
  try {
    const state = await input.executor({
      input: {
        include: ["source_revision", "task_projection"],
      },
      taskContract: input.taskContract,
      tool: "workspace_state",
      workspaceRoot: input.workspaceRoot,
    });
    const compact = compactWorkspaceStateResult(
      state,
      ["source_revision", "task_projection"],
      {},
      initialTaskBriefingMaximumTokens,
    );
    if (compact.status !== "success") return undefined;
    return JSON.stringify(compact.data);
  } catch {
    return undefined;
  }
}

export function appendInitialTaskBriefing(
  systemPrompt: string,
  briefing: string | undefined,
) {
  if (!briefing) return systemPrompt;
  return `${systemPrompt}\n\n<task_briefing>\nRuntime-generated starting map. Use these targets, dependencies, and tasks directly; do not call workspace_state merely to rediscover them. Refresh workspace_state only when this map is missing required metadata or the workspace changed.\n${briefing}\n</task_briefing>`;
}
