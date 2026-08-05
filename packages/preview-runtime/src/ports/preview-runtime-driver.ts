import type { EndpointMap } from "../domain/endpoint-map.js";
import type {
  PreviewExecutionPlan,
  RuntimeSelection,
} from "../domain/execution-plan.js";
import type {
  PreviewSessionState,
  RuntimeProtocolHandshake,
} from "../domain/preview-session.js";
import type { CapabilityReport } from "../domain/runtime-capabilities.js";
import type { RuntimeProfileId } from "../domain/runtime-profile.js";

declare const runtimeHandleBrand: unique symbol;
export type RuntimeHandle = {
  readonly [runtimeHandleBrand]: true;
  fencingToken?: number;
};

export type RuntimeFile = {
  path: string;
  content: Uint8Array;
  mode?: number;
  symlinkTarget?: string;
};

export type ExecInput = {
  command: string;
  args?: string[];
  cwd?: string;
  environment?: Record<string, string>;
  timeoutMs?: number;
};

export type ExecResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
};

export type ProvisionInput = {
  sessionId: string;
  userStoryId: string;
  generation: number;
  fencingToken: number;
  plan: PreviewExecutionPlan;
  resourceSize: { vcpus: number; memoryGb: number };
};

export type SourceArtifact = {
  id: string;
  revision: string;
  downloadUrl?: string;
  sha256: string;
  size: number;
  mode?: "full" | "delta" | "baseline";
  sanitizedTreeHash?: string;
  lockfileHash?: string;
  workspaceHash?: string;
};

export type SyncReceipt = { sourceRevision: string; workspaceHash: string };
export type DurableDeltaReceipt = {
  artifactId: string;
  baseHash: string;
  finalHash: string;
  generation: number;
  revision: string;
  durableAt: string;
};
export type SuspendReceipt = { snapshotId?: string; suspendedAt: string };
export type DestroyReceipt = { destroyedAt: string; pendingCleanupIds: string[] };
export type RuntimeUsage = {
  /** Provider-lifetime cumulative counters. Consumers derive deltas between samples. */
  activeCpuSeconds: number;
  memoryGbSeconds: number;
  ingressBytes: number;
  egressBytes: number;
  snapshotBytes: number;
  estimatedCostUsd: number;
  observedAt: string;
};

export type RuntimeObservation = {
  host: "running" | "suspended" | "destroyed" | "missing" | "failed";
  engine: "idle" | "running" | "stopped" | "failed";
  generation?: number;
  services: Array<{ id: string; running: boolean; healthy?: boolean }>;
  journalRevision?: string;
  handshake?: RuntimeProtocolHandshake;
  state?: Partial<PreviewSessionState>;
};

export type LogRequest = { handle: RuntimeHandle; cursor?: string; serviceId?: string };
export type PreviewLogEvent = {
  sessionId: string;
  sequence: number;
  timestamp: string;
  state: PreviewSessionState;
  serviceId?: string;
  stream: "system" | "stdout" | "stderr";
  message: string;
};

export interface ExecutionHost {
  exec(input: ExecInput): Promise<ExecResult>;
  writeFiles(files: RuntimeFile[]): Promise<void>;
  readFiles(paths: string[]): Promise<RuntimeFile[]>;
}
export type EngineContext = { host: ExecutionHost; sessionId: string };
export type RuntimeInspectOptions = { probeServices?: boolean };

export interface PreviewExecutionEngine {
  prepare(context: EngineContext, plan: PreviewExecutionPlan): Promise<void>;
  startServices(context: EngineContext, selection: RuntimeSelection): Promise<void>;
  stopServices(context: EngineContext): Promise<void>;
  inspect(context: EngineContext): Promise<RuntimeObservation>;
}
export interface PreviewRuntimeDriver {
  readonly profile: RuntimeProfileId;
  capabilities(plan: PreviewExecutionPlan): Promise<CapabilityReport>;
  provisionHost(input: ProvisionInput): Promise<RuntimeHandle>;
  resumeHost(handle: RuntimeHandle): Promise<void>;
  syncIn(handle: RuntimeHandle, source: SourceArtifact): Promise<SyncReceipt>;
  restoreBaseline?(handle: RuntimeHandle, snapshotId: string): Promise<RuntimeHandle>;
  prepareEngine(handle: RuntimeHandle, plan: PreviewExecutionPlan): Promise<void>;
  startServices(handle: RuntimeHandle, selection: RuntimeSelection): Promise<void>;
  stopServices(handle: RuntimeHandle): Promise<void>;
  exec(handle: RuntimeHandle, input: ExecInput): Promise<ExecResult>;
  inspect(
    handle: RuntimeHandle,
    options?: RuntimeInspectOptions,
  ): Promise<RuntimeObservation>;
  endpoints(handle: RuntimeHandle): Promise<EndpointMap>;
  logs(input: LogRequest): AsyncIterable<PreviewLogEvent>;
  exportDelta(handle: RuntimeHandle, revision: string): Promise<DurableDeltaReceipt>;
  acknowledgeDelta?(handle: RuntimeHandle, revision: string): Promise<void>;
  suspendHost(handle: RuntimeHandle): Promise<SuspendReceipt>;
  destroyHost(handle: RuntimeHandle): Promise<DestroyReceipt>;
  usage(handle: RuntimeHandle): Promise<RuntimeUsage>;
  sweepOrphans?(
    activeSessionIds: string[],
    olderThan: string,
  ): Promise<{ deleted: number }>;
}

export function runtimeHandle(value: object): RuntimeHandle {
  return value as RuntimeHandle;
}

export function fenceRuntimeHandle(handle: RuntimeHandle, fencingToken: number) {
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 1) {
    throw new Error("Runtime fencing token is invalid.");
  }
  handle.fencingToken = fencingToken;
  return handle;
}
