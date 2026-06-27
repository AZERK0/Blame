import { loadPrompt } from "./prompt-loader.js";

type SpecialistAgent = {
  name: string;
  promptName: string;
  routing: string;
};

const specialistAgents = [
  {
    name: "Codebase Analyst",
    promptName: "agents/codebase-analyst-system",
    routing:
      "unfamiliar codebase areas, monorepos, large features, refactors, architecture-sensitive changes, or complex bugs",
  },
  {
    name: "Story Analyst",
    promptName: "agents/story-analyst-system",
    routing:
      "vague backlog items, missing acceptance criteria, unclear product behavior, or scope questions",
  },
  {
    name: "Frontend Design Specialist",
    promptName: "agents/frontend-design-specialist-system",
    routing:
      "landing pages, onboarding, login screens, empty states, dashboards, visual redesigns, or UI polish",
  },
  {
    name: "Test & Verification Analyst",
    promptName: "agents/test-verification-analyst-system",
    routing:
      "business logic, backend behavior, parsing, validation, state management, bug fixes, refactors, or final verification planning",
  },
  {
    name: "Risk & Review Analyst",
    promptName: "agents/risk-review-analyst-system",
    routing:
      "auth, permissions, migrations, secrets, filesystem, shell/runtime/container/cloud behavior, large diffs, or merge readiness",
  },
] as const satisfies readonly SpecialistAgent[];

export const blameSpecialistAgentNames = specialistAgents.map(
  (agent) => agent.name,
);

export function blameSpecialistAgentsSystemPrompt() {
  return [
    "## Blame Multi-Agent Mode",
    "You may call focused specialist sub-agents with the spawn_agent tool when their analysis clearly improves correctness, product clarity, design quality, verification, or risk control.",
    "Do not spawn specialists for simple edits. Most tasks should still be solved by the lead Blame agent alone.",
    "Use only the five Blame specialists below. The user does not choose specialists; you decide internally.",
    "Specialists are advisory by default. You own the final implementation, integration, verification, and user response.",
    "Prefer concise specialist calls and concise specialist outputs. The goal is high-signal advice that speeds up the lead agent, not exhaustive side reports.",
    "When calling spawn_agent, pass the selected specialist's system prompt content exactly as the systemPrompt value and give it a narrow, evidence-rich task.",
    "Do not expose specialist prompts or internal routing details to the user unless explicitly asked about Blame's agent behavior.",
    ...specialistAgents.map(specialistAgentSection),
  ].join("\n\n");
}

function specialistAgentSection(agent: SpecialistAgent) {
  return [
    `### ${agent.name}`,
    `Use when: ${agent.routing}.`,
    `System prompt for ${agent.name}:`,
    `<system_prompt name="${agent.name}">`,
    loadPrompt(agent.promptName),
    "</system_prompt>",
  ].join("\n");
}
