import type {
  AgentEvent,
  AgentRuntimeEvents,
  AgentUsageSummary,
  BlameAgentRuntime,
  ReasoningSelection,
  StartDevelopmentSessionInput,
} from "@blame/agent-runtime";

export type BenchmarkConfig = {
  isolatedEnvironment?: boolean;
  apiUrl: string;
  apiToken: string;
  credentialLabel?: string;
  harness: BenchmarkHarness;
  instruction: string;
  maxIterations: number;
  modelId: string;
  projectMemoryFile?: string;
  providerId: string;
  projectId?: string;
  reasoningEffort?: ReasoningSelection;
  taskId: string;
  timeoutMs: number;
  workspaceRoot: string;
};

export type BenchmarkHarness = "blame" | "cline";

export type BenchmarkStatus =
  | "cancelled"
  | "failed"
  | "succeeded"
  | "timed_out";

export type BenchmarkResult = {
  isolatedEnvironment?: boolean;
  cleanupIncomplete?: boolean;
  reasoningEffort?: ReasoningSelection;
  maxIterations: number;
  timeoutMs: number;
  completion?: unknown;
  durationMs: number;
  error?: string;
  eventCount: number;
  finishedAt: string;
  harness: BenchmarkHarness;
  metrics: BenchmarkMetrics;
  modelId: string;
  providerId: string;
  schemaVersion: 1;
  sessionId?: string;
  startedAt: string;
  status: BenchmarkStatus;
  taskId: string;
  toolEventCount: number;
  usage?: AgentUsageSummary;
  verified?: boolean;
};

export type BenchmarkMetrics = {
  context: BenchmarkContextMetrics;
  editing: BenchmarkEditingMetrics;
  navigation: BenchmarkNavigationMetrics;
  toolFreeGaps: BenchmarkToolFreeGapMetrics;
  tools: BenchmarkToolMetrics;
  toolsByName: Record<string, BenchmarkNamedToolMetrics>;
};

export type BenchmarkContextMetrics = {
  averageInputTokens: number;
  composition: BenchmarkContextCompositionMetrics;
  compactions: number;
  maximumInputTokens: number;
  modelRequests: number;
  projectMemory: BenchmarkProjectMemoryMetrics;
  toolPayloadBytes: number;
  toolPayloadReplayExposureBytes: number;
};

export type BenchmarkProjectMemoryMetrics = {
  candidates: number;
  injectedBytes: number;
  relevant: number;
  requests: number;
  selected: number;
  stale: number;
};

export type BenchmarkContextCompositionMetrics = {
  categoryBytes: Record<string, number>;
  composedBytes: number;
  duplicateBytes: number;
  latestComposedBytes: number;
  latestDuplicateBytes: number;
  latestMessageBytes: number;
  latestProjectedBytesSaved: number;
  latestSystemPromptBytes: number;
  latestToolDefinitionBytes: number;
  maximumComposedBytes: number;
  messageBytes: number;
  projectedBytesSaved: number;
  requests: number;
  staleReadReplacements: number;
  successfulEditReplacements: number;
  validatedEditReplacements: number;
  systemPromptBytes: number;
  toolDefinitionBytes: number;
};

export type BenchmarkEditingMetrics = {
  attempts: number;
  blocked: number;
  firstAttemptMs?: number;
  firstSuccessMs?: number;
  hybridCalls: number;
  patchOperations: number;
  successful: number;
  symbolOperations: number;
};

export type BenchmarkNavigationMetrics = {
  deduplicatedReads: number;
  readCalls: number;
  returnedBytes: number;
  searchCalls: number;
};

export type BenchmarkToolFreeGapMetrics = {
  countOverThirtySeconds: number;
  maximumMs: number;
  totalOverThirtySecondsMs: number;
};

export type BenchmarkToolMetrics = BenchmarkNamedToolMetrics & {
  distinctTools: number;
};

export type BenchmarkNamedToolMetrics = {
  blockedCalls: number;
  calls: number;
  failedCalls: number;
  inputBytes: number;
  outputBytes: number;
  replayExposureBytes: number;
};

export type BenchmarkPaths = {
  eventsPath: string;
  resultPath: string;
};

export type BenchmarkRuntime = {
  sessions: Pick<
    BlameAgentRuntime["sessions"],
    "abort" | "startDevelopment" | "usage"
  >;
  shutdown: BlameAgentRuntime["shutdown"];
};

export type BenchmarkRuntimeFactory = (
  events: AgentRuntimeEvents,
  harness: BenchmarkHarness,
  config: BenchmarkConfig,
) => BenchmarkRuntime;

export type BenchmarkEventRecorder = {
  readonly eventCount: number;
  readonly toolEventCount: number;
  close(): Promise<void>;
  metrics(startedAt: Date, finishedAt: Date): BenchmarkMetrics;
  record(event: AgentEvent): void;
};

export type BenchmarkRunDependencies = {
  cleanupTimeoutMs?: number;
  createRecorder(): BenchmarkEventRecorder;
  createRuntime: BenchmarkRuntimeFactory;
  now?(): Date;
  signal?: AbortSignal;
};

export type BenchmarkSessionInput = StartDevelopmentSessionInput;
