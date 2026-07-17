export type BacklogColumnId =
  | "backlog"
  | "ready"
  | "in-progress"
  | "in-review"
  | "done"
  | "discarded";

export type MockAgentStatus = "Running" | "Paused";

export type MockStory = {
  id: string;
  reference: string;
  title: string;
  status: BacklogColumnId;
  agentStatus?: MockAgentStatus;
  detail?: string;
};

export const backlogColumns = [
  {
    id: "backlog",
    title: "Backlog",
    description: "Draft user stories",
  },
  {
    id: "ready",
    title: "Agent Queue",
    description: "Ready for agents",
  },
  {
    id: "in-progress",
    title: "In Progress",
    description: "Active worktrees",
  },
  {
    id: "in-review",
    title: "In Review",
    description: "Waiting for validation",
  },
  {
    id: "done",
    title: "Done",
    description: "Merged user stories",
  },
  {
    id: "discarded",
    title: "Discarded",
    description: "Rejected or cancelled",
  },
] as const satisfies ReadonlyArray<{
  id: BacklogColumnId;
  title: string;
  description: string;
}>;

export const heroBacklogStories: ReadonlyArray<MockStory> = [
  {
    id: "story-700",
    reference: "US-700",
    title: "Define a first-run onboarding path",
    status: "backlog",
  },
  {
    id: "story-708",
    reference: "US-708",
    title: "Add secure credential vault",
    status: "ready",
  },
  {
    id: "story-709",
    reference: "US-709",
    title: "Build project activity timeline",
    status: "ready",
  },
  {
    id: "story-706",
    reference: "US-706",
    title: "Build repository insights panel",
    status: "in-progress",
    agentStatus: "Running",
  },
  {
    id: "story-707",
    reference: "US-707",
    title: "Add AI setup checklist",
    status: "in-progress",
    agentStatus: "Running",
  },
  {
    id: "story-710",
    reference: "US-710",
    title: "Generate user story drafts",
    status: "in-progress",
    agentStatus: "Running",
  },
  {
    id: "story-711",
    reference: "US-711",
    title: "Run preview environment checks",
    status: "in-progress",
    agentStatus: "Paused",
  },
  {
    id: "story-712",
    reference: "US-712",
    title: "Review merge readiness summary",
    status: "in-review",
  },
  {
    id: "story-713",
    reference: "US-713",
    title: "Launch guided backlog board",
    status: "done",
  },
  {
    id: "story-714",
    reference: "US-714",
    title: "Ship provider connection flow",
    status: "done",
  },
  {
    id: "story-715",
    reference: "US-715",
    title: "Complete project switcher polish",
    status: "done",
  },
  {
    id: "story-701",
    reference: "US-701",
    title: "Add a project health snapshot",
    status: "discarded",
    detail: "Discarded from backlog",
  },
  {
    id: "story-705",
    reference: "US-705",
    title: "Create backlog priority filters",
    status: "discarded",
    detail: "Rejected during review",
  },
];

export const pipelineBacklogStories: ReadonlyArray<MockStory> = [
  {
    id: "pipeline-804",
    reference: "US-804",
    title: "Add keyboard command palette",
    status: "backlog",
  },
  {
    id: "pipeline-805",
    reference: "US-805",
    title: "Verify deployment rollback flow",
    status: "in-progress",
    agentStatus: "Running",
  },
];

export const pipelineStatusOrder = backlogColumns.map(
  (column) => column.id,
) as BacklogColumnId[];

export function storyStatusLabel(story: MockStory) {
  if (story.status === "backlog") return "Draft";
  if (story.status === "ready") return "Queued";
  if (story.agentStatus) return story.agentStatus;
  if (story.status === "in-review") return "Review";
  if (story.status === "done") return "Merged";
  return "Rejected";
}

export function nextPipelineStatus(status: BacklogColumnId) {
  const index = pipelineStatusOrder.indexOf(status);
  return pipelineStatusOrder[(index + 1) % pipelineStatusOrder.length];
}
