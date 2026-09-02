import { loadPrompt } from "./prompt-loader.js";

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
    routing:
      "unfamiliar codebase areas, monorepos, large features, refactors, architecture-sensitive changes, or complex bugs",
  },
  {
    id: "story_analyst",
    name: "Story Analyst",
    promptName: "agents/story-analyst-system",
    routing:
      "vague backlog items, missing acceptance criteria, unclear product behavior, or scope questions",
  },
  {
    id: "frontend_design",
    name: "Frontend Design Specialist",
    promptName: "agents/frontend-design-specialist-system",
    routing:
      "visual surface implementation such as landing pages, onboarding, login screens, empty states, dashboards, redesigns, or UI polish; never backend, API, schema, or data work merely because the feature has a visual name",
  },
  {
    id: "test_verification",
    name: "Test & Verification Analyst",
    promptName: "agents/test-verification-analyst-system",
    routing:
      "business logic, backend behavior, parsing, validation, state management, bug fixes, refactors, or final verification planning",
  },
  {
    id: "risk_review",
    name: "Risk & Review Analyst",
    promptName: "agents/risk-review-analyst-system",
    routing:
      "auth, permissions, migrations, secrets, filesystem, shell/runtime/container/cloud behavior, large diffs, or merge readiness",
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
    "Use consult_specialist only when the user or lead explicitly requests it, never automatically because work is ambiguous, risky, or failing.",
    "Use at most one specialist unless the explicit request names more.",
    "The tool lists available specialists and supplies their private instructions internally. They are read-only and advisory; you own implementation, verification, decisions, and communication.",
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
