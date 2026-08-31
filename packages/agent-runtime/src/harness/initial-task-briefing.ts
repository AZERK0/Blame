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
const initialTaskBriefingSections = [
  "source_revision",
  "task_contract",
  "repository",
  "capabilities",
  "task_projection",
] as const;

export async function createInitialTaskBriefing(
  input: InitialTaskBriefingInput,
) {
  try {
    const state = await input.executor({
      input: {
        include: [...initialTaskBriefingSections],
      },
      taskContract: input.taskContract,
      tool: "workspace_state",
      workspaceRoot: input.workspaceRoot,
    });
    const compact = compactWorkspaceStateResult(
      state,
      [...initialTaskBriefingSections],
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
  return `${systemPrompt}\n\n<task_briefing>\nRuntime-generated starting map. Treat its revision-bound targets, dependency declarations, lockfile presence, capabilities, and tasks as resolved evidence. Do not reread manifests, lockfiles, or workspace_state to verify facts already stated here. Start from the first relevant target and make the first coherent edit after only the inspection needed for that target. Refresh workspace_state only when required metadata is absent or the workspace changed. Specialist advice is optional and never a prerequisite for a reversible first edit.\n${briefing}\n</task_briefing>`;
}
