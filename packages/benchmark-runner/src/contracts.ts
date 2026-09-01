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
  record(event: AgentEvent): void;
};

export type BenchmarkRunDependencies = {
  createRecorder(): BenchmarkEventRecorder;
  createRuntime: BenchmarkRuntimeFactory;
  now?(): Date;
  signal?: AbortSignal;
};

export type BenchmarkSessionInput = StartDevelopmentSessionInput;
