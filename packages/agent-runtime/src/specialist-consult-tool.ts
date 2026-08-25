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
  additional_consultation_justification: z
    .string()
    .trim()
    .min(20)
    .max(2_000)
    .optional(),
});

export type ConsultSpecialistInput = z.infer<
  typeof consultSpecialistInputSchema
>;

type ConsultSpecialistToolOptions = {
  capsule?: (input: ConsultSpecialistInput) => Promise<string | undefined>;
  objective?: string;
  spawnTool: Pick<
    AgentTool<{ systemPrompt: string; task: string }, unknown>,
    "execute"
  >;
  storyId?: string;
  timeoutMs?: number;
};

type ConsultationState = Map<string, number>;

export function createConsultSpecialistTool(
  options: ConsultSpecialistToolOptions,
): AgentTool {
  const state: ConsultationState = new Map();
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
    timeoutMs: options.timeoutMs ?? 90_000,
    retryable: false,
    maxRetries: 0,
    execute: (raw: unknown, context: AgentToolContext) =>
      executeConsultation(raw, context, options, state),
  });
}

async function executeConsultation(
  raw: unknown,
  context: AgentToolContext,
  options: ConsultSpecialistToolOptions,
  state: ConsultationState,
) {
  const parsed = consultSpecialistInputSchema.safeParse(raw);
  if (!parsed.success) return invalidConsultation(parsed.error.issues);
  const specialist = blameSpecialistAgent(parsed.data.specialist);
  if (!specialist)
    return { isError: true, output: { error: "Unknown Blame specialist." } };
  const scope = consultationScope(context);
  const count = state.get(scope) ?? 0;
  if (count > 0 && !parsed.data.additional_consultation_justification)
    return repeatedConsultationDenied();
  state.set(scope, count + 1);
  const capsule = await options.capsule?.(parsed.data);
  return options.spawnTool.execute(
    {
      systemPrompt: specialist.systemPrompt,
      task: specialistTask(parsed.data, options, capsule),
    },
    context,
  );
}

function consultationScope(context: AgentToolContext) {
  const explicit = context.metadata?.changeRequestId;
  if (typeof explicit === "string" && explicit.trim()) return explicit;
  return context.runId ?? context.conversationId ?? "active-change-request";
}

function invalidConsultation(issues: Array<{ message: string }>) {
  return {
    isError: true,
    output: {
      error: "Invalid consult_specialist input.",
      issues: issues.map(({ message }) => message),
    },
  };
}

function repeatedConsultationDenied() {
  return {
    isError: true,
    output: {
      error:
        "One specialist has already been consulted for this change request. Provide a structured additional_consultation_justification only when another specialist is materially necessary.",
    },
  };
}

function specialistTask(
  input: ConsultSpecialistInput,
  options: Omit<ConsultSpecialistToolOptions, "spawnTool">,
  capsule?: string,
) {
  return [
    "You are advising the lead Blame development agent. Do not implement or modify anything.",
    options.objective
      ? `<root_user_objective>\n${options.objective}\n</root_user_objective>`
      : undefined,
    options.storyId ? `<story_id>${options.storyId}</story_id>` : undefined,
    capsule,
    `<lead_request>\n${input.task}\n</lead_request>`,
    input.context
      ? `<relevant_context>\n${input.context}\n</relevant_context>`
      : undefined,
    input.additional_consultation_justification
      ? `<additional_consultation_justification>\n${input.additional_consultation_justification}\n</additional_consultation_justification>`
      : undefined,
    "Inspect only what is needed, distinguish evidence from inference, and return concise advice the lead can act on.",
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
}
