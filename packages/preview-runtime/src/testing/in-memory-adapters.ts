import type { EndpointMap } from "../domain/endpoint-map.js";
import type {
  PreviewExecutionPlan,
  RuntimeSelection,
} from "../domain/execution-plan.js";
import type {
  PreviewSessionEvent,
  PreviewSessionRecord,
} from "../domain/preview-session.js";
import { resolveCapabilities } from "../compilation/capability-resolver.js";
import type { DistributedLock, LockLease } from "../ports/distributed-lock.js";
import type { PreviewEventSink } from "../ports/preview-event-sink.js";
import {
  runtimeHandle,
  type ExecInput,
  type LogRequest,
  type PreviewLogEvent,
  type PreviewRuntimeDriver,
  type ProvisionInput,
  type RuntimeHandle,
  type RuntimeObservation,
  type SourceArtifact,
} from "../ports/preview-runtime-driver.js";
import {
  OptimisticRevisionError,
  type PreviewOperationRecord,
  type SessionRepository,
} from "../ports/session-repository.js";
import type { RuntimeProfileId } from "../domain/runtime-profile.js";

export class InMemorySessionRepository implements SessionRepository {
  private records = new Map<string, PreviewSessionRecord>();
  private handles = new Map<string, RuntimeHandle>();
  private operations = new Map<string, PreviewOperationRecord>();

  async create(record: PreviewSessionRecord) {
    if (this.records.has(record.id))
      throw new Error("Preview session already exists.");
    this.records.set(record.id, structuredClone(record));
  }

  async get(sessionId: string) {
    const record = this.records.get(sessionId);
    return record ? structuredClone(record) : undefined;
  }

  async save(record: PreviewSessionRecord, expectedRevision: number) {
    const current = this.records.get(record.id);
    if (!current || current.revision !== expectedRevision)
      throw new OptimisticRevisionError();
    this.records.set(record.id, structuredClone(record));
  }

  async listReconcileCandidates(now: string, limit: number) {
    return [...this.records.values()]
      .filter(
        (record) =>
          [
            "suspended",
            "suspending",
            "destroyed",
            "destroying",
            "unprovisioned",
          ].includes(record.state.host) === false &&
          Boolean(record.providerHandleEncrypted) &&
          Boolean(record.idleDeadlineAt && record.idleDeadlineAt <= now),
      )
      .slice(0, limit)
      .map((record) => structuredClone(record));
  }

  async getRuntimeHandle(sessionId: string) {
    return this.handles.get(sessionId);
  }

  async setRuntimeHandle(
    sessionId: string,
    handle: RuntimeHandle | undefined,
    _fencingToken?: number,
  ) {
    if (handle) this.handles.set(sessionId, handle);
    else this.handles.delete(sessionId);
  }

  async getOperation(sessionId: string, operationId: string) {
    const value = this.operations.get(`${sessionId}:${operationId}`);
    return value ? structuredClone(value) : undefined;
  }

  async saveOperation(operation: PreviewOperationRecord) {
    this.operations.set(
      `${operation.sessionId}:${operation.operationId}`,
      structuredClone(operation),
    );
  }
}
export class InMemoryDistributedLock implements DistributedLock {
  private tails = new Map<string, Promise<void>>();
  private fencingTokens = new Map<string, number>();

  async withLock<T>(key: string, operation: (lease: LockLease) => Promise<T>) {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const tail = new Promise<void>((resolve) => (release = resolve));
    this.tails.set(
      key,
      previous.then(() => tail),
    );
    await previous;
    const fencingToken = (this.fencingTokens.get(key) ?? 0) + 1;
    this.fencingTokens.set(key, fencingToken);
    try {
      return await operation({ key, fencingToken });
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export class InMemoryPreviewEventSink implements PreviewEventSink {
  private values: PreviewSessionEvent[] = [];

  async append(event: Omit<PreviewSessionEvent, "cursor" | "sequence">) {
    const sequence =
      this.values.filter(({ sessionId }) => sessionId === event.sessionId)
        .length + 1;
    const value = {
      ...structuredClone(event),
      sequence,
      cursor: String(sequence),
    };
    this.values.push(value);
    return structuredClone(value);
  }

  async *events(sessionId: string, cursor?: string) {
    const after = Number(cursor ?? 0);
    for (const event of this.values) {
      if (event.sessionId === sessionId && event.sequence > after)
        yield structuredClone(event);
    }
  }
}

type FakeHost = {
  id: string;
  plan: PreviewExecutionPlan;
  running: boolean;
  suspended: boolean;
  destroyed: boolean;
  journalRevision: number;
  endpointsRevision: number;
};

export class FakePreviewRuntimeDriver implements PreviewRuntimeDriver {
  readonly calls: string[] = [];
  readonly provisionInputs: ProvisionInput[] = [];
  exportDeltaFailure?: Error;
  readonly unavailableServiceIds = new Set<string>();
  private hosts = new Map<RuntimeHandle, FakeHost>();

  constructor(readonly profile: RuntimeProfileId = "vercel-compose") {}

  async capabilities(plan: PreviewExecutionPlan) {
    return resolveCapabilities(this.profile, plan);
  }

  async provisionHost(input: ProvisionInput) {
    this.calls.push("provisionHost");
    this.provisionInputs.push(structuredClone(input));
    const handle = runtimeHandle({ id: input.sessionId });
    this.hosts.set(handle, {
      id: input.sessionId,
      plan: structuredClone(input.plan),
      running: false,
      suspended: false,
      destroyed: false,
      journalRevision: 0,
      endpointsRevision: 1,
    });
    return { handle, observation: this.observation(this.host(handle)) };
  }

  async resumeHost(handle: RuntimeHandle) {
    this.calls.push("resumeHost");
    const host = this.host(handle);
    host.suspended = false;
    host.endpointsRevision += 1;
    return this.observation(host);
  }

  async syncIn(handle: RuntimeHandle, source: SourceArtifact) {
    this.calls.push("syncIn");
    this.host(handle).journalRevision += 1;
    return { sourceRevision: source.revision, workspaceHash: source.sha256 };
  }

  async prepareEngine(handle: RuntimeHandle, plan: PreviewExecutionPlan) {
    this.calls.push("prepareEngine");
    this.host(handle).plan = structuredClone(plan);
  }

  async startServices(handle: RuntimeHandle, _selection: RuntimeSelection) {
    this.calls.push("startServices");
    this.host(handle).running = true;
  }

  async startPreview(
    handle: RuntimeHandle,
    plan: PreviewExecutionPlan,
    _selection: RuntimeSelection,
  ) {
    this.calls.push("startPreview");
    const host = this.host(handle);
    host.plan = structuredClone(plan);
    host.running = true;
    return {
      observation: this.observation(host),
      endpointMap: this.endpointMap(host),
    };
  }

  async stopServices(handle: RuntimeHandle) {
    this.calls.push("stopServices");
    this.host(handle).running = false;
  }

  async exec(_handle: RuntimeHandle, input: ExecInput) {
    this.calls.push("exec");
    return { exitCode: 0, stdout: input.command, stderr: "" };
  }

  async inspect(handle: RuntimeHandle): Promise<RuntimeObservation> {
    this.calls.push("inspect");
    return this.observation(this.host(handle));
  }

  async endpoints(handle: RuntimeHandle): Promise<EndpointMap> {
    this.calls.push("endpoints");
    return this.endpointMap(this.host(handle));
  }

  private observation(host: FakeHost): RuntimeObservation {
    return {
      host: host.destroyed
        ? "destroyed"
        : host.suspended
          ? "suspended"
          : "running",
      engine: host.running ? "running" : "stopped",
      services: host.plan.services.map(({ id }) => ({
        id,
        running: host.running && !this.unavailableServiceIds.has(id),
        healthy: true,
      })),
      journalRevision: String(host.journalRevision),
      handshake: {
        protocolVersion: 3,
        runnerVersion: "test",
        imageDigest: "sha256:test",
        capabilities: resolveCapabilities(this.profile, host.plan).capabilities,
      },
    };
  }

  private endpointMap(host: FakeHost): EndpointMap {
    const routes = host.plan.networking.gatewayListeners.map((route) => ({
      ...route,
      routeId: `${host.id}:${route.routeKey}`,
      protocol: "http" as const,
      logicalHost: "localhost" as const,
      publicUrl: `https://${host.id}-${route.endpointId}.preview.example`,
      externallyCompatible: !host.plan.networking.integratedPreviewRequired,
    }));
    const primary = routes[0];
    return {
      revision: host.endpointsRevision,
      primaryRouteId: primary?.routeId ?? "",
      primaryPublicUrl: primary?.publicUrl ?? "",
      routes,
      supportsWebSocket: true,
      integratedPreviewRequired: host.plan.networking.integratedPreviewRequired,
      incompatibilityReasons: [...host.plan.networking.incompatibilityReasons],
    };
  }

  async *logs(_input: LogRequest): AsyncIterable<PreviewLogEvent> {}

  async exportDelta(handle: RuntimeHandle, revision: string) {
    this.calls.push("exportDelta");
    if (this.exportDeltaFailure) throw this.exportDeltaFailure;
    const host = this.host(handle);
    return {
      artifactId: `delta-${host.id}-${revision}`,
      baseHash: "base",
      finalHash: `final-${revision}`,
      generation: 1,
      revision,
      durableAt: new Date().toISOString(),
    };
  }

  async acknowledgeDelta(_handle: RuntimeHandle, _revision: string) {
    this.calls.push("acknowledgeDelta");
  }

  async suspendHost(handle: RuntimeHandle) {
    this.calls.push("suspendHost");
    this.host(handle).suspended = true;
    return { snapshotId: "snapshot", suspendedAt: new Date().toISOString() };
  }

  async destroyHost(handle: RuntimeHandle) {
    this.calls.push("destroyHost");
    this.host(handle).destroyed = true;
    return { destroyedAt: new Date().toISOString(), pendingCleanupIds: [] };
  }

  async usage(_handle: RuntimeHandle) {
    return {
      activeCpuSeconds: 0,
      memoryGbSeconds: 0,
      ingressBytes: 0,
      egressBytes: 0,
      snapshotBytes: 0,
      estimatedCostUsd: 0,
      observedAt: new Date().toISOString(),
    };
  }

  mutate(handle: RuntimeHandle) {
    this.host(handle).journalRevision += 1;
  }

  private host(handle: RuntimeHandle) {
    const host = this.hosts.get(handle);
    if (!host) throw new Error("Unknown fake runtime handle.");
    return host;
  }
}
