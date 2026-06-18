import type { CoreSessionConfig } from "@cline/sdk";
import type {
  CodeGraphArchitectureOverviewInput,
  CodeGraphImpactRadiusInput,
  CodeGraphQueryInput,
  CodeGraphReviewContextInput,
  CodeGraphUpdateInput,
  CodeReviewGraphProvider,
} from "./types.js";

type AgentTool = NonNullable<CoreSessionConfig["extraTools"]>[number];

type ToolContext = Parameters<AgentTool["execute"]>[1];

const statusToolName = "get_code_graph_status";
const updateToolName = "update_code_graph";
const reviewContextToolName = "get_code_review_context";
const impactRadiusToolName = "get_code_impact_radius";
const architectureOverviewToolName = "get_code_architecture_overview";

export const codeReviewGraphToolNames = [
  statusToolName,
  updateToolName,
  reviewContextToolName,
  impactRadiusToolName,
  architectureOverviewToolName,
];

export function codeReviewGraphTools(
  provider: CodeReviewGraphProvider | undefined,
  worktree: string | undefined,
) {
  if (!provider || !worktree) return [];
  return [
    codeGraphStatusTool(provider, worktree),
    codeGraphUpdateTool(provider, worktree),
    codeGraphReviewContextTool(provider, worktree),
    codeGraphImpactRadiusTool(provider, worktree),
    codeGraphArchitectureOverviewTool(provider, worktree),
  ];
}

function codeGraphStatusTool(
  provider: CodeReviewGraphProvider,
  worktree: string,
): AgentTool {
  return {
    name: statusToolName,
    description:
      "Get the local code-review-graph status for the current Blame worktree. Returns availability, freshness, stats, and the next recommended action.",
    inputSchema: waitInputSchema,
    execute(input: unknown, context: ToolContext) {
      return provider.status({
        ...waitInput(input),
        signal: context.signal,
        worktree,
      });
    },
  };
}

function codeGraphUpdateTool(
  provider: CodeReviewGraphProvider,
  worktree: string,
): AgentTool {
  return {
    name: updateToolName,
    description:
      "Build or incrementally update the local code-review-graph for the current Blame worktree. Read-only for source code; never runs arbitrary commands. Use before concluding the graph is unavailable or stale.",
    inputSchema: {
      type: "object",
      properties: {
        force: {
          type: "boolean",
          description:
            "Force a rebuild even when the graph appears fresh. Defaults to false.",
        },
        waitMs: waitMsSchema,
      },
      additionalProperties: false,
    },
    execute(input: unknown, context: ToolContext) {
      return provider.update({
        ...updateInput(input),
        signal: context.signal,
        worktree,
      });
    },
  };
}

function codeGraphReviewContextTool(
  provider: CodeReviewGraphProvider,
  worktree: string,
): AgentTool {
  return {
    name: reviewContextToolName,
    description:
      "Get a compact code review context for the current worktree diff. Use after making or inspecting changes to identify minimal files, risks, and test gaps before reading more files.",
    inputSchema: reviewContextInputSchema,
    execute(input: unknown, context: ToolContext) {
      return provider.reviewContext({
        ...reviewContextInput(input),
        signal: context.signal,
        worktree,
      });
    },
  };
}

function codeGraphImpactRadiusTool(
  provider: CodeReviewGraphProvider,
  worktree: string,
): AgentTool {
  return {
    name: impactRadiusToolName,
    description:
      "Get the compact impact radius for changed files in the current worktree. Use after a diff to understand affected functions, files, and risk before broad file reads.",
    inputSchema: impactRadiusInputSchema,
    execute(input: unknown, context: ToolContext) {
      return provider.impactRadius({
        ...impactRadiusInput(input),
        signal: context.signal,
        worktree,
      });
    },
  };
}

function codeGraphArchitectureOverviewTool(
  provider: CodeReviewGraphProvider,
  worktree: string,
): AgentTool {
  return {
    name: architectureOverviewToolName,
    description:
      "Get a compact architecture overview from the local code-review-graph. Use before reading many files in an unfamiliar area.",
    inputSchema: architectureOverviewInputSchema,
    execute(input: unknown, context: ToolContext) {
      return provider.architectureOverview({
        ...architectureOverviewInput(input),
        signal: context.signal,
        worktree,
      });
    },
  };
}

function reviewContextInput(
  input: unknown,
): Omit<CodeGraphReviewContextInput, "worktree"> {
  const record = asRecord(input);
  return {
    ...impactRadiusInput(input),
    includeSource: booleanValue(record.includeSource),
    maxLinesPerFile: boundedNumber(record.maxLinesPerFile, 20, 200),
  };
}

function impactRadiusInput(
  input: unknown,
): Omit<CodeGraphImpactRadiusInput, "worktree"> {
  const record = asRecord(input);
  return {
    ...queryInput(input),
    maxDepth: boundedNumber(record.maxDepth, 1, 4),
  };
}

function architectureOverviewInput(
  input: unknown,
): Omit<CodeGraphArchitectureOverviewInput, "worktree"> {
  const record = asRecord(input);
  const detailLevel = stringValue(record.detailLevel);
  return {
    ...queryInput(input),
    detailLevel: detailLevel === "standard" ? "standard" : "minimal",
  };
}

function updateInput(input: unknown): Omit<CodeGraphUpdateInput, "worktree"> {
  const record = asRecord(input);
  return {
    force: booleanValue(record.force),
    waitMs: boundedNumber(record.waitMs, 0, 60_000),
  };
}

function waitInput(input: unknown): Pick<CodeGraphQueryInput, "waitMs"> {
  const record = asRecord(input);
  return {
    waitMs: boundedNumber(record.waitMs, 0, 60_000),
  };
}

function queryInput(input: unknown): Omit<CodeGraphQueryInput, "worktree"> {
  const record = asRecord(input);
  return {
    base: stringValue(record.base),
    changedFiles: stringArray(record.changedFiles),
    waitMs: boundedNumber(record.waitMs, 0, 60_000),
  };
}

function asRecord(value: unknown) {
  if (value && typeof value === "object")
    return value as Record<string, unknown>;
  return {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function boundedNumber(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(Math.max(Math.round(number), min), max);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

const waitMsSchema = {
  type: "number",
  description:
    "Maximum time to wait for a missing or stale graph update, in milliseconds. Defaults are bounded by Blame.",
};

const waitInputSchema = {
  type: "object",
  properties: {
    waitMs: waitMsSchema,
  },
  additionalProperties: false,
};

const queryProperties = {
  base: {
    type: "string",
    description:
      "Git ref used to detect changes. Defaults to code-review-graph's normal base.",
  },
  changedFiles: {
    type: "array",
    items: { type: "string" },
    description:
      "Optional relative changed file paths. Omit to let code-review-graph detect the diff.",
  },
  waitMs: waitMsSchema,
};

const impactRadiusInputSchema = {
  type: "object",
  properties: {
    ...queryProperties,
    maxDepth: {
      type: "number",
      description:
        "Dependency traversal depth. Defaults to 2 and is capped by Blame.",
    },
  },
  additionalProperties: false,
};

const reviewContextInputSchema = {
  type: "object",
  properties: {
    ...impactRadiusInputSchema.properties,
    includeSource: {
      type: "boolean",
      description:
        "Include short source snippets in the review context. Defaults to false for compactness.",
    },
    maxLinesPerFile: {
      type: "number",
      description:
        "Maximum source lines per file when includeSource is true. Defaults are capped by Blame.",
    },
  },
  additionalProperties: false,
};

const architectureOverviewInputSchema = {
  type: "object",
  properties: {
    detailLevel: {
      type: "string",
      enum: ["minimal", "standard"],
      description:
        "Overview detail level. Use minimal unless per-edge architecture detail is needed.",
    },
    waitMs: waitMsSchema,
  },
  additionalProperties: false,
};
