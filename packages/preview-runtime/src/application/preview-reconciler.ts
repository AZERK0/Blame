import type { PreviewSessionRecord } from "../domain/preview-session.js";
import {
  PreviewRuntimeError,
  previewFailure,
} from "../domain/preview-errors.js";
import {
  fenceRuntimeHandle,
  type PreviewRuntimeDriver,
  type RuntimeHandle,
  type RuntimeObservation,
} from "../ports/preview-runtime-driver.js";
import type { SessionRepository } from "../ports/session-repository.js";
import type { PreviewEventSink } from "../ports/preview-event-sink.js";

export type PreviewReconcilerOptions = {
  repository: SessionRepository;
  eventSink: PreviewEventSink;
  drivers: Map<string, PreviewRuntimeDriver>;
};

export class PreviewReconciler {
  private readonly options: PreviewReconcilerOptions;

  constructor(options: PreviewReconcilerOptions) {
    this.options = options;
  }

  async reconcile(record: PreviewSessionRecord, fencingToken: number) {
    const driver = this.options.drivers.get(record.profile);
    if (!driver)
      throw unsupported(`No driver is registered for ${record.profile}.`);
    const expectedRevision = record.revision;
    const next = structuredClone(record);
    next.fencingToken = fencingToken;
    try {
      const capabilityReport = await driver.capabilities(next.plan);
      if (!capabilityReport.compatible) {
        throw unsupported(
          capabilityReport.incompatibilities
            .map(({ message }) => message)
            .join(" "),
        );
      }
      let handle = await this.options.repository.getRuntimeHandle(next.id);
      let observedHandshake: RuntimeObservation["handshake"];
      if (handle) {
        fenceRuntimeHandle(handle, fencingToken);
        await this.options.repository.setRuntimeHandle(next.id, handle);
        const observation = await driver.inspect(handle, {
          probeServices: false,
        });
        if (
          observation.host === "missing" ||
          observation.host === "destroyed"
        ) {
          await this.options.repository.setRuntimeHandle(
            next.id,
            undefined,
            fencingToken,
          );
          handle = undefined;
          next.state.host = "unprovisioned";
          next.state.engine = "idle";
          next.state.preview = "closed";
        } else {
          applyObservation(next, observation);
          if (observation.host === "running")
            observedHandshake = observation.handshake;
        }
      }
      const host = await this.reconcileHost(driver, next, handle);
      handle = host.handle;
      await this.acknowledgeRemoteDelta(driver, next, handle);
      if (handle && next.desired.host === "active") {
        applyHandshake(
          next,
          observedHandshake ??
            host.observation?.handshake ??
            (await driver.inspect(handle, { probeServices: false })).handshake,
        );
        await this.reconcileEngine(driver, next, handle);
        await this.reconcileAgent(next);
      }
      next.failure = undefined;
      next.revision = expectedRevision + 1;
      await this.options.repository.save(next, expectedRevision);
      await this.emitState(next, "Preview session reconciled.");
      return next;
    } catch (error) {
      const failed = failedRecord(next, error, expectedRevision + 1);
      await this.options.repository.save(failed, expectedRevision);
      await this.emitState(
        failed,
        failed.failure?.message ?? "Preview session failed.",
        "failure",
      );
      throw error;
    }
  }

  private async reconcileHost(
    driver: PreviewRuntimeDriver,
    record: PreviewSessionRecord,
    handle: RuntimeHandle | undefined,
  ): Promise<{
    handle: RuntimeHandle | undefined;
    observation?: RuntimeObservation;
  }> {
    if (record.desired.host === "destroyed") {
      if (handle) {
        if (record.state.engine === "running") {
          record.state.engine = "stopping";
          await driver.stopServices(handle);
          record.state.engine = "stopped";
          record.state.preview = "closed";
        }
        await this.ensureDeltaExported(driver, record, handle);
        if (record.state.sync === "pending_local_sync") {
          throw new PreviewRuntimeError({
            code: "SYNC_CONFLICT",
            message:
              "The latest durable delta must be applied locally before host destruction.",
            retryable: false,
          });
        }
        record.state.host = "destroying";
        await driver.destroyHost(handle);
        await this.options.repository.setRuntimeHandle(
          record.id,
          undefined,
          record.fencingToken,
        );
      }
      record.state.host = "destroyed";
      record.state.engine = "stopped";
      record.state.preview = "closed";
      record.stoppedAt = new Date().toISOString();
      return { handle: undefined };
    }
    if (record.desired.host === "suspended") {
      if (!handle || record.state.host === "unprovisioned") {
        record.state.host = "suspended";
        return { handle };
      }
      if (record.state.host === "suspended" && record.state.sync !== "failed") {
        return { handle };
      }
      if (record.state.host === "suspended") {
        record.state.host = "resuming";
        await driver.resumeHost(handle);
        await this.options.repository.setRuntimeHandle(record.id, handle);
        record.state.host = "running";
        record.generation += 1;
        record.endpointMap = undefined;
      }
      if (record.state.engine === "running") await driver.stopServices(handle);
      record.state.engine = "stopped";
      record.state.preview = "closed";
      let exportError: unknown;
      try {
        await this.ensureDeltaExported(driver, record, handle);
      } catch (error) {
        record.state.sync = "failed";
        exportError = error;
      }
      record.state.host = "suspending";
      await driver.suspendHost(handle);
      record.state.host = "suspended";
      if (exportError) throw exportError;
      return { handle };
    }
    if (!handle || ["unprovisioned", "destroyed"].includes(record.state.host)) {
      record.state.host = "provisioning";
      let created;
      try {
        created = await driver.provisionHost(provisionInput(record));
      } catch (error) {
        if (!missingProvisionSnapshot(record, error)) throw error;
        record.baselineId = undefined;
        record.provisionSource = undefined;
        created = await driver.provisionHost(provisionInput(record));
      }
      fenceRuntimeHandle(created.handle, record.fencingToken);
      await this.options.repository.setRuntimeHandle(record.id, created.handle);
      record.state.host = "running";
      return created;
    }
    if (["suspended", "failed"].includes(record.state.host)) {
      record.state.host = "resuming";
      const observation = await driver.resumeHost(handle);
      await this.options.repository.setRuntimeHandle(record.id, handle);
      record.state.host = "running";
      record.generation += 1;
      record.endpointMap = undefined;
      return { handle, observation: observation || undefined };
    }
    return { handle };
  }

  private async reconcileEngine(
    driver: PreviewRuntimeDriver,
    record: PreviewSessionRecord,
    handle: RuntimeHandle,
  ) {
    if (record.desired.services === "stopped") {
      if (["running", "starting", "preparing"].includes(record.state.engine)) {
        record.state.engine = "stopping";
        await driver.stopServices(handle);
        await this.ensureDeltaExported(driver, record, handle);
      }
      record.state.engine = "stopped";
      record.state.preview = "closed";
      return;
    }
    if (record.state.engine !== "running") {
      record.state.engine = "preparing";
      const selection = {
        configurationId: record.selection?.configurationId ?? "default",
        serviceIds: record.selection?.serviceIds,
        primaryRoute: record.selection?.primaryRoute,
      };
      if (record.desired.preview === "open" && driver.startPreview) {
        const started = await driver.startPreview(
          handle,
          record.plan,
          selection,
        );
        assertServicesReady(record, started.observation);
        record.state.engine = "running";
        record.state.preview = "ready";
        record.endpointMap = started.endpointMap;
        return;
      }
      await driver.prepareEngine(handle, record.plan);
      record.state.engine = "starting";
      await driver.startServices(handle, selection);
    }
    const observation = await driver.inspect(handle);
    assertServicesReady(record, observation);
    record.state.engine = "running";
    if (record.desired.preview === "open") {
      record.state.preview = "opening";
      record.endpointMap = await driver.endpoints(handle);
      record.state.preview = "ready";
    }
  }

  private async reconcileAgent(record: PreviewSessionRecord) {
    if (record.desired.agent === "running") {
      throw unsupported(
        "Managed agent execution requires a remote WorkspaceExecutor and credential broker.",
      );
    } else {
      if (record.state.agent === "running") record.state.agent = "stopping";
      record.state.agent = "idle";
    }
  }

  private async ensureDeltaExported(
    driver: PreviewRuntimeDriver,
    record: PreviewSessionRecord,
    handle: RuntimeHandle,
  ) {
    if (
      record.profile === "local-container" ||
      record.state.sync === "discarded"
    )
      return;
    const preserveConflict = record.state.sync === "conflict";
    record.state.sync = "exporting";
    const observation = await driver.inspect(handle);
    const revision =
      observation.journalRevision ?? record.lastExportedJournalRevision ?? "0";
    if (
      record.lastExportedJournalRevision === revision &&
      record.pendingDeltaArtifactId
    ) {
      record.state.sync = preserveConflict ? "conflict" : "pending_local_sync";
      return;
    }
    if (record.lastAppliedLocalRevision === revision) {
      record.state.sync = "clean";
      return;
    }
    const receipt = await driver.exportDelta(handle, revision);
    record.lastExportedJournalRevision = receipt.revision;
    record.pendingDeltaArtifactId = receipt.artifactId;
    record.state.sync = preserveConflict ? "conflict" : "pending_local_sync";
  }

  private async acknowledgeRemoteDelta(
    driver: PreviewRuntimeDriver,
    record: PreviewSessionRecord,
    handle: RuntimeHandle | undefined,
  ) {
    const revision = record.lastAppliedLocalRevision;
    if (!revision) return;
    if (!handle) {
      if (record.state.sync === "applying") {
        record.lastAcknowledgedRemoteRevision = revision;
        record.pendingDeltaArtifactId = undefined;
        record.state.sync = "clean";
      }
      return;
    }
    if (
      record.lastAcknowledgedRemoteRevision !== revision &&
      record.state.host === "running"
    ) {
      if (driver.acknowledgeDelta)
        await driver.acknowledgeDelta(handle, revision);
      record.lastAcknowledgedRemoteRevision = revision;
    }
    if (record.state.sync === "applying") {
      record.pendingDeltaArtifactId = undefined;
      record.state.sync = "clean";
    }
  }

  private emitState(
    record: PreviewSessionRecord,
    message: string,
    type: "state" | "failure" = "state",
  ) {
    return this.options.eventSink.append({
      sessionId: record.id,
      timestamp: new Date().toISOString(),
      type,
      state: structuredClone(record.state),
      stream: "system",
      message,
    });
  }
}

function provisionInput(record: PreviewSessionRecord) {
  return {
    sessionId: record.id,
    userStoryId: record.userStoryId,
    generation: record.generation,
    fencingToken: record.fencingToken,
    plan: record.plan,
    resourceSize: record.resourceSize,
    source: record.provisionSource,
  };
}

function missingProvisionSnapshot(
  record: PreviewSessionRecord,
  error: unknown,
) {
  return (
    Boolean(record.provisionSource) &&
    error instanceof PreviewRuntimeError &&
    error.failure.providerCode === "BASELINE_SNAPSHOT_NOT_FOUND"
  );
}

function assertServicesReady(
  record: PreviewSessionRecord,
  observation: Awaited<ReturnType<PreviewRuntimeDriver["inspect"]>>,
) {
  const expectedServices = expectedServiceIds(record);
  const stopped = observation.services.filter(
    ({ id, running }) => expectedServices.has(id) && !running,
  );
  if (stopped.length) {
    throw new PreviewRuntimeError({
      code: "ENGINE_START_FAILED",
      message: `Services did not remain running: ${stopped.map(({ id }) => id).join(", ")}.`,
      retryable: true,
    });
  }
  const unhealthy = observation.services.filter(
    (service) => service.running && service.healthy === false,
  );
  if (unhealthy.length) {
    throw new PreviewRuntimeError({
      code: "HEALTHCHECK_FAILED",
      message: `Healthcheck failed for ${unhealthy.map(({ id }) => id).join(", ")}.`,
      retryable: true,
    });
  }
}

function expectedServiceIds(record: PreviewSessionRecord) {
  const expected = new Set(
    record.selection?.serviceIds !== undefined
      ? record.selection.serviceIds
      : record.plan.services.map(({ id }) => id),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const service of record.plan.services) {
      if (!expected.has(service.id)) continue;
      for (const dependency of service.dependsOn) {
        if (expected.has(dependency)) continue;
        expected.add(dependency);
        changed = true;
      }
    }
  }
  return expected;
}

function applyObservation(
  record: PreviewSessionRecord,
  observation: import("../ports/preview-runtime-driver.js").RuntimeObservation,
) {
  applyHandshake(record, observation.handshake);
  if (
    Number.isSafeInteger(observation.generation) &&
    Number(observation.generation) > record.generation
  ) {
    record.generation = Number(observation.generation);
    record.endpointMap = undefined;
  }
  if (observation.host === "running") record.state.host = "running";
  else if (observation.host === "suspended") record.state.host = "suspended";
  else if (observation.host === "failed") record.state.host = "failed";
  record.state.engine = observation.engine;
  if (observation.engine !== "running") record.state.preview = "closed";
}

function applyHandshake(
  record: PreviewSessionRecord,
  handshake:
    | import("../domain/preview-session.js").RuntimeProtocolHandshake
    | undefined,
) {
  if (!handshake) return;
  record.protocolVersion = handshake.protocolVersion;
  record.runnerVersion = handshake.runnerVersion;
  record.imageDigest = handshake.imageDigest;
}

function unsupported(message: string) {
  return new PreviewRuntimeError({
    code: "UNSUPPORTED_CAPABILITY",
    message,
    retryable: false,
  });
}

function failedRecord(
  record: PreviewSessionRecord,
  error: unknown,
  revision: number,
) {
  const failed = structuredClone(record);
  failed.revision = revision;
  failed.failure = previewFailure(error);
  if (
    ["provisioning", "resuming", "suspending", "destroying"].includes(
      failed.state.host,
    )
  ) {
    failed.state.host = "failed";
  }
  if (["preparing", "starting", "stopping"].includes(failed.state.engine)) {
    failed.state.engine = "failed";
  }
  if (["opening", "closing"].includes(failed.state.preview))
    failed.state.preview = "degraded";
  if (["starting", "stopping"].includes(failed.state.agent))
    failed.state.agent = "failed";
  if (["importing", "exporting", "applying"].includes(failed.state.sync))
    failed.state.sync = "failed";
  return failed;
}
