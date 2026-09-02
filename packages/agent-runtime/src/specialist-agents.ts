import { loadPrompt } from "./prompt-loader.js";
import type { StartDevelopmentSessionInput } from "./types.js";

export const blameSpecialistAgentIds = [
  "codebase_analyst",
  "story_analyst",
  "frontend_design",
  "test_verification",
  "risk_review",
] as const;

export type BlameSpecialistAgentId = (typeof blameSpecialistAgentIds)[number];

type SpecialistAgent = {
  id: BlameSpecialistAgentId;
  name: string;
  promptName: string;
  routing: string;
};

const specialistAgents = [
  {
    id: "codebase_analyst",
    name: "Codebase Analyst",
    promptName: "agents/codebase-analyst-system",
    routing: "architecture, monorepos, large refactors, or complex bugs",
  },
  {
    id: "story_analyst",
    name: "Story Analyst",
    promptName: "agents/story-analyst-system",
    routing: "ambiguous behavior, acceptance criteria, or scope",
  },
  {
    id: "frontend_design",
    name: "Frontend Design Specialist",
    promptName: "agents/frontend-design-specialist-system",
    routing: "visual surfaces, UX, responsive behavior, or UI polish",
  },
  {
    id: "test_verification",
    name: "Test & Verification Analyst",
    promptName: "agents/test-verification-analyst-system",
    routing: "business logic, backend behavior, tests, or verification",
  },
  {
    id: "risk_review",
    name: "Risk & Review Analyst",
    promptName: "agents/risk-review-analyst-system",
    routing: "auth, migrations, secrets, runtime boundaries, or merge risk",
  },
] as const satisfies readonly SpecialistAgent[];

export const blameSpecialistAgentNames = specialistAgents.map(
  (agent) => agent.name,
);

export const blameSpecialistAgentMetadata = specialistAgents.map(
  ({ id, name, routing }) => ({ id, name, routing }),
);

export function blameSpecialistRoutingSystemPrompt() {
  return [
    "## Blame Specialist Consultations",
    "Use consult_specialist only for the explicit specialist request. Use at most one unless the request names more. Specialists are private, read-only advisers; you retain implementation and verification.",
  ].join("\n");
}

export function blameSpecialistAgent(id: BlameSpecialistAgentId) {
  const agent = specialistAgents.find((candidate) => candidate.id === id);
  if (!agent) return undefined;
  return {
    ...agent,
    systemPrompt: loadPrompt(agent.promptName),
  };
}

export function developmentSpecialistConsultEnabled(
  input: Pick<
    StartDevelopmentSessionInput,
    | "autoSendPrompt"
    | "enableSpecialistConsult"
    | "feedback"
    | "summary"
    | "title"
  >,
) {
  if (input.enableSpecialistConsult !== undefined)
    return input.enableSpecialistConsult;
  if (input.autoSendPrompt === false) return true;
  const request = [input.title, input.summary, input.feedback]
    .filter(Boolean)
    .join(" ");
  return /\b(?:specialist|expert|reviewer)\b|(?:spécialiste|avis (?:expert|extérieur|indépendant)|seconde? avis)/iu.test(
    request,
  );
}
