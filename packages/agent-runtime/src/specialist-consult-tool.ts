import { createTool, type AgentTool, type AgentToolContext } from "@cline/sdk";
import { z } from "zod";

import {
  blameSpecialistAgent,
  blameSpecialistAgentIds,
  blameSpecialistAgentMetadata,
} from "./specialist-agents.js";

const consultSpecialistInputSchema = z.object({
  specialist: z.enum(blameSpecialistAgentIds),
  task: z.string().trim().min(1).max(12_000),
  context: z.string().trim().max(20_000).optional(),
});

export type ConsultSpecialistInput = z.infer<
  typeof consultSpecialistInputSchema
>;

type ConsultSpecialistToolOptions = {
  objective?: string;
  spawnTool: Pick<
    AgentTool<{ systemPrompt: string; task: string }, unknown>,
    "execute"
  >;
  storyId?: string;
};

export function createConsultSpecialistTool(
  options: ConsultSpecialistToolOptions,
): AgentTool {
  return createTool<unknown, unknown>({
    name: "consult_specialist",
    description: [
      "Consult one private, read-only Blame specialist for a focused advisory analysis.",
      "The lead agent remains the sole implementer. Use only when a second opinion materially improves the result; skip for simple work.",
      "Available specialists:",
      ...blameSpecialistAgentMetadata.map(
        (agent) => `${agent.id} (${agent.name}): ${agent.routing}`,
      ),
    ].join("\n"),
    inputSchema: consultSpecialistInputSchema as unknown as Record<
      string,
      unknown
    >,
    timeoutMs: 300_000,
    retryable: false,
    maxRetries: 0,
    async execute(raw: unknown, context: AgentToolContext) {
      const parsed = consultSpecialistInputSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          isError: true,
          output: {
            error: "Invalid consult_specialist input.",
            issues: parsed.error.issues.map((issue) => issue.message),
          },
        };
      }
      const specialist = blameSpecialistAgent(parsed.data.specialist);
      if (!specialist) {
        return {
          isError: true,
          output: { error: "Unknown Blame specialist." },
        };
      }
      return options.spawnTool.execute(
        {
          systemPrompt: specialist.systemPrompt,
          task: specialistTask(parsed.data, options),
        },
        context,
      );
    },
  });
}

function specialistTask(
  input: ConsultSpecialistInput,
  options: Omit<ConsultSpecialistToolOptions, "spawnTool">,
) {
  return [
    "You are advising the lead Blame development agent. Do not implement or modify anything.",
    options.objective
      ? `<root_user_objective>\n${options.objective}\n</root_user_objective>`
      : undefined,
    options.storyId ? `<story_id>${options.storyId}</story_id>` : undefined,
    `<lead_request>\n${input.task}\n</lead_request>`,
    input.context
      ? `<relevant_context>\n${input.context}\n</relevant_context>`
      : undefined,
    "Inspect only what is needed, distinguish evidence from inference, and return concise advice the lead can act on.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}
