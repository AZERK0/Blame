import type { StartSessionInput } from "./types.js";
import {
  ATTR_BLAME_AGENT_ITERATION,
  ATTR_BLAME_AGENT_ROLE,
  ATTR_BLAME_AGENT_STRATEGY,
  ATTR_BLAME_MULTI_AGENT_ENABLED,
  ATTR_BLAME_PROVIDER_AUTH_TYPE,
  ATTR_BLAME_REPOSITORY_LANGUAGE,
  ATTR_BLAME_REPOSITORY_SIZE_BUCKET,
  ATTR_BLAME_TASK_COMPLEXITY_BUCKET,
  ATTR_BLAME_TOOL_CATEGORY,
  ATTR_BLAME_TOOL_NAME,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_TOOL_NAME,
  type BlameSpan,
  type ExecutionComponent,
  type ExecutionDescriptor,
  GEN_AI_OPERATION_CHAT,
  getBlameTelemetry,
} from "@blame/telemetry";

export type AgentTelemetryInput = Pick<
  StartSessionInput,
  "modelId" | "providerId"
> &
  Partial<
    Pick<StartSessionInput, "autoSendPrompt" | "executionId" | "storyId">
  > & {
    enableAgentTeams?: boolean;
    enableSpawnAgent?: boolean;
    repositoryLanguage?: string;
    repositorySizeBucket?: string;
    taskComplexityBucket?: string;
  };

export type UsageSnapshot = {
  cacheCreated: number;
  cacheRead: number;
  cost: number;
  input: number;
  output: number;
};

export type ToolSpanState = {
  agentKey: string;
  category: string;
  iteration: number;
  name: string;
  role: string;
  span: BlameSpan;
};

type AgentInvocationSpanState = {
  parentAgentKey: string;
  parentTool?: BlameSpan;
  span: BlameSpan;
};

export type ModelSpanState = {
  firstChunkRecorded: boolean;
  iteration: number;
  role: string;
  span: BlameSpan;
  usage: UsageSnapshot;
};

export type AgentSessionTelemetry = {
  agentIterations: Map<string, number>;
  agentSpans: Map<string, AgentInvocationSpanState>;
  aggregateUsageCursor: UsageSnapshot;
  authType?: string;
  component?: ExecutionComponent;
  descriptor: ExecutionDescriptor;
  firstActionRecorded: boolean;
  firstEditRecorded: boolean;
  input: AgentTelemetryInput;
  iteration: number;
  iterations: Set<string>;
  modelSpans: Map<string, ModelSpanState>;
  multiAgentUsed: boolean;
  retryCount: number;
  toolCallCount: number;
  toolSpans: Map<string, ToolSpanState>;
  turnStartedAt: number;
  usage: UsageSnapshot;
  usageByAgent: Map<string, UsageSnapshot>;
};

export const telemetry = getBlameTelemetry();

export function modelAttributes(
  state: AgentSessionTelemetry,
  role: string,
  iteration = state.iteration,
) {
  return {
    ...cohortAttributes(state.input),
    [ATTR_BLAME_AGENT_ITERATION]: iteration,
    [ATTR_BLAME_AGENT_ROLE]: role,
    [ATTR_BLAME_AGENT_STRATEGY]: sessionAgentStrategy(state),
    [ATTR_BLAME_MULTI_AGENT_ENABLED]: multiAgentEnabled(state.input),
    [ATTR_BLAME_PROVIDER_AUTH_TYPE]: state.authType,
    [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_CHAT,
    [ATTR_GEN_AI_PROVIDER_NAME]: state.input.providerId,
    [ATTR_GEN_AI_REQUEST_MODEL]: state.input.modelId,
  };
}

export function cohortAttributes(input: AgentTelemetryInput) {
  return {
    [ATTR_BLAME_REPOSITORY_LANGUAGE]: input.repositoryLanguage,
    [ATTR_BLAME_REPOSITORY_SIZE_BUCKET]: input.repositorySizeBucket,
    [ATTR_BLAME_TASK_COMPLEXITY_BUCKET]: input.taskComplexityBucket,
  };
}

export function metricDimensions(state: AgentSessionTelemetry) {
  return {
    ...modelAttributes(state, "lead"),
    [ATTR_BLAME_PROVIDER_AUTH_TYPE]: state.authType,
  };
}

export function toolMetricAttributes(
  state: AgentSessionTelemetry,
  tool: Omit<ToolSpanState, "span">,
) {
  return {
    ...modelAttributes(state, tool.role, tool.iteration),
    [ATTR_BLAME_TOOL_CATEGORY]: tool.category,
    [ATTR_BLAME_TOOL_NAME]: tool.name,
    [ATTR_GEN_AI_TOOL_NAME]: tool.name,
  };
}

export function turnDuration(state: AgentSessionTelemetry) {
  return Math.max(0, performance.now() - state.turnStartedAt) / 1_000;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function stringValue(value: unknown) {
  return typeof value === "string" && value ? value : undefined;
}

export function numericValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function sessionAgentStrategy(state: AgentSessionTelemetry) {
  return configuredAgentStrategy(state.input);
}

export function configuredAgentStrategy(input: AgentTelemetryInput) {
  return multiAgentEnabled(input) ? "multi_agent" : "single_agent";
}

export function multiAgentEnabled(input: AgentTelemetryInput) {
  return Boolean(input.enableAgentTeams || input.enableSpawnAgent);
}
