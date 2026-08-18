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
      "landing pages, onboarding, login screens, empty states, dashboards, visual redesigns, or UI polish",
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
    "Use the consult_specialist tool only when a focused second opinion materially improves correctness, product clarity, design quality, verification, or risk control.",
    "Do not consult a specialist for simple edits. Most tasks should still be solved by the lead Blame agent alone.",
    "The tool supplies the selected specialist's private instructions internally. Never attempt to provide, reconstruct, or request a specialist system prompt.",
    "Give the specialist a narrow, evidence-rich question. Include the relevant user requirements, constraints, decisions already made, and files or behavior to inspect.",
    "Every specialist is read-only and advisory. You own all implementation, integration, verification, product decisions, and user communication.",
    ...specialistAgents.map(
      (agent) => `- ${agent.id} — ${agent.name}: ${agent.routing}.`,
    ),
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
