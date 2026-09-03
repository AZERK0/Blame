import type { CompletionDecision } from "@blame/harness-core";
import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { finishTaskInputSchema } from "./light-contracts.js";
import type { LightRunTaskInput } from "./light-contracts.js";
import type { ProjectMemoryCandidate } from "./project-memory.js";

export const lightCompletionToolName = "finish_task";

export type LightCompletionNotification = {
  completion: CompletionDecision;
  memory?: ProjectMemoryCandidate;
  submission_outcome: "accepted" | "blocked";
  summary: string;
  verified: boolean;
};

export type LightValidationActivity = {
  input: LightRunTaskInput;
  output?: unknown;
  phase: "finished" | "started";
  toolCallId: string;
};

export function createLightCompletionTool(
  submit: (summary: string, context: AgentToolContext) => Promise<unknown>,
): AgentTool {
  return createTool({
    name: lightCompletionToolName,
    description:
      "Finish with a concise natural summary. Mention a non-obvious durable implementation decision only when it helps future work. The runtime checks known changes, reuses current validation, and runs at most one missing relevant validation. Do not provide receipts or internal state.",
    inputSchema: finishTaskInputSchema as unknown as Record<string, unknown>,
    lifecycle: { completesRun: true },
    retryable: false,
    maxRetries: 0,
    execute(input: unknown, context: AgentToolContext) {
      const parsed = finishTaskInputSchema.parse(input);
      return submit(parsed.summary, context);
    },
  });
}
