import type {
  AgentEvent,
  AgentRuntimeEvents,
  AgentUsageSummary,
  BlameAgentRuntime,
  ReasoningSelection,
  StartDevelopmentSessionInput,
} from "@blame/agent-runtime";

export type BenchmarkConfig = {
  apiUrl: string;
  apiToken: string;
  credentialLabel?: string;
  harness: BenchmarkHarness;
  instruction: string;
  maxIterations: number;
  modelId: string;
  providerId: string;
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
  compactions: number;
  maximumInputTokens: number;
  modelRequests: number;
  toolPayloadBytes: number;
  toolPayloadReplayExposureBytes: number;
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
) => BenchmarkRuntime;

export type BenchmarkEventRecorder = {
  readonly eventCount: number;
  readonly toolEventCount: number;
  close(): Promise<void>;
  metrics(startedAt: Date, finishedAt: Date): BenchmarkMetrics;
  record(event: AgentEvent): void;
};

export type BenchmarkRunDependencies = {
  createRecorder(): BenchmarkEventRecorder;
  createRuntime: BenchmarkRuntimeFactory;
  now?(): Date;
  signal?: AbortSignal;
};

export type BenchmarkSessionInput = StartDevelopmentSessionInput;
