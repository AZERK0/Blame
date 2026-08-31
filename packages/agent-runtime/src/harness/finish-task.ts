import type { AgentToolContext } from "@cline/sdk";
import {
  createLightCompletionTool,
  type LightCompletionNotification,
  type LightValidationActivity,
} from "./light-completion.js";
import type { LightTaskContract } from "./light-contracts.js";
import {
  lightToolContext,
  type LightWorkspaceExecutor,
} from "./light-executor.js";
import { LightFinishService } from "./light-finish-service.js";

export type FinishTaskOptions = {
  conversationId: string;
  executor?: LightWorkspaceExecutor;
  onComplete?(notification: LightCompletionNotification): Promise<void> | void;
  onValidationActivity?(
    activity: LightValidationActivity,
  ): Promise<void> | void;
  taskContract?: LightTaskContract;
  workspaceRoot: string;
};

export function createFinishTaskTool(options: FinishTaskOptions) {
  if (options.executor)
    return createLightCompletionTool((summary, context) =>
      finishRemotely(options, summary, context),
    );
  const service = new LightFinishService(options);
  return createLightCompletionTool((summary, context) =>
    service.finish(summary, context),
  );
}

async function finishRemotely(
  options: FinishTaskOptions,
  summary: string,
  context: AgentToolContext,
) {
  const result = await options.executor!(
    {
      input: { summary },
      taskContract: options.taskContract,
      tool: "finish_task",
      toolContext: lightToolContext(context),
      workspaceRoot: options.workspaceRoot,
    },
    context.signal,
  );
  if (result.status !== "ok") throw new Error(result.message);
  const data = recordValue(result.data);
  const notification = data.notification as
    | LightCompletionNotification
    | undefined;
  const activities = Array.isArray(data.validationActivities)
    ? (data.validationActivities as LightValidationActivity[])
    : [];
  for (const activity of activities)
    await options.onValidationActivity?.(activity);
  if (notification) await options.onComplete?.(notification);
  return typeof data.summary === "string" ? data.summary : summary;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
