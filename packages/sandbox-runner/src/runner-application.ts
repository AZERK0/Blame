import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, open, readFile, realpath, writeFile } from "node:fs/promises";
import type {
  PreviewExecutionPlan,
  PreviewSessionState,
  RuntimeObservation,
  RuntimeSelection,
} from "@blame/preview-runtime";
import type { RunnerRequest } from "./protocol/runner-contract.js";
import { runnerHandshake } from "./protocol/runner-contract.js";
import { runnerError } from "./protocol/runner-server.js";
import { readRuntimeState, writeRuntimeState } from "./runtime-state.js";
import { runtimePaths } from "./runtime-paths.js";
import { ComposeSupervisor } from "./supervisor/compose-supervisor.js";
import { ProcessSupervisor } from "./supervisor/process-supervisor.js";
import { normalizeRuntimeSelection } from "./supervisor/runtime-selection.js";
import { probeServices } from "./supervisor/service-probes.js";
import { GatewaySupervisor } from "./gateway/gateway-supervisor.js";
import { importSourceArtifact } from "./workspace/source-importer.js";
import {
  acknowledgeSourceDelta,
  prepareSourceDelta,
  uploadSourceDelta,
} from "./workspace/source-exporter.js";
import {
  checkpointChangeJournal,
  readChangeJournal,
} from "./workspace/change-journal.js";
import { processLogEvents } from "./logs/log-multiplexer.js";

const compose = new ComposeSupervisor();
const processes = new ProcessSupervisor();
const gateway = new GatewaySupervisor();

export class RunnerApplication {
  async dispatch(request: RunnerRequest): Promise<unknown> {
    switch (request.operation) {
      case "handshake":
        return handshake();
      case "resume-host":
        return this.resumeHost(request.sessionId, request.generation);
      case "prepare-engine":
        return this.prepare(request);
      case "start-services":
        return this.start(request.selection);
      case "stop-services":
        return this.stop();
      case "inspect":
        return this.inspect(request.probeServices);
      case "endpoints":
        return this.endpoints();
      case "logs":
        return this.logs(request.cursor, request.serviceId);
      case "source-import":
        return this.importSource(request.source);
      case "source-export-prepare":
        return prepareSourceDelta(request.artifactId, request.revision);
      case "source-export-upload":
        return uploadSourceDelta(request.artifactId, request.upload);
      case "source-export-ack":
        return acknowledgeSourceDelta(request.revision);
      case "exec":
        return this.exec(request);
    }
  }

  private async resumeHost(sessionId: string, generation: number) {
    const state = await readRuntimeState();
    if (
      !sessionId ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      (state.sessionId && state.sessionId !== sessionId) ||
      generation < state.generation
    ) {
      throw runnerError("INVALID_SESSION_CONTEXT", "Runner resume context is invalid.");
    }
    state.sessionId = sessionId;
    state.generation = generation;
    state.running = false;
    state.servicePids = {};
    state.selection = undefined;
    await writeRuntimeState(state);
    return { generation };
  }

  private async prepare(
    request: Extract<RunnerRequest, { operation: "prepare-engine" }>,
  ) {
    assertExecutionPlan(request.plan);
    if (!request.sessionId || !Number.isSafeInteger(request.generation)) {
      throw runnerError("INVALID_SESSION_CONTEXT", "Runner session context is invalid.");
    }
    if (
      request.plan.networking.gatewayListeners.length &&
      !request.capabilityPublicKey?.includes("BEGIN PUBLIC KEY")
    ) {
      throw runnerError("GATEWAY_KEY_MISSING", "Preview gateway verification key is missing.");
    }
    const state = await readRuntimeState();
    if (state.running) throw runnerError("ENGINE_RUNNING", "Stop services before changing the plan.");
    if (request.engine === "vercel-compose") {
      await compose.prepare(request.plan, request.browserBindingUrls ?? {});
    } else await processes.prepare(request.plan);
    if (request.capabilityPublicKey) {
      await writeFile(runtimePaths.capabilityPublicKey, request.capabilityPublicKey, {
        mode: 0o600,
        flush: true,
      });
    }
    await writeFile(runtimePaths.plan, JSON.stringify(request.plan), { mode: 0o600, flush: true });
    await writeRuntimeState({
      ...state,
      engine: request.engine,
      plan: request.plan,
      prepared: true,
      running: false,
      servicePids: {},
      browserBindingUrls: request.browserBindingUrls ?? {},
      sessionId: request.sessionId,
      generation: request.generation!,
    });
    return { prepared: true };
  }

  private async start(requestedSelection: RuntimeSelection) {
    const state = await requiredPreparedState();
    if (state.running) return { running: true };
    const selection = normalizeRuntimeSelection(state.plan!, requestedSelection);
    if (state.engine === "vercel-compose") await compose.start(selection);
    else {
      state.servicePids = await processes.start(
        state.plan!,
        selection,
        state.browserBindingUrls,
      );
    }
    state.selection = selection;
    try {
      const routes = await this.gatewayRoutes(state);
      if (routes.length) {
        await gateway.start({
          publicKeyPem: await readFile(runtimePaths.capabilityPublicKey, "utf8"),
          routes,
        });
      }
    } catch (error) {
      if (state.engine === "vercel-compose") await compose.stop().catch(() => undefined);
      else await processes.stop(state.servicePids).catch(() => undefined);
      state.servicePids = {};
      state.selection = undefined;
      throw error;
    }
    state.running = true;
    state.endpointRevision += 1;
    await writeRuntimeState(state);
    return { running: true };
  }

  private async stop() {
    const state = await readRuntimeState();
    if (!state.running) return { running: false };
    await gateway.stop();
    if (state.engine === "vercel-compose") await compose.stop();
    else await processes.stop(state.servicePids);
    state.running = false;
    state.servicePids = {};
    state.selection = undefined;
    await checkpointChangeJournal();
    await writeRuntimeState(state);
    return { running: false };
  }

  private async inspect(shouldProbeServices = true): Promise<RuntimeObservation> {
    const state = await readRuntimeState();
    let services: RuntimeObservation["services"] = [];
    if (state.plan && state.running) {
      const targets = await this.targets(state);
      const processState =
        state.engine === "vercel-compose"
          ? await compose.inspect(state.plan)
          : processes.inspect(state.plan, state.servicePids);
      const probes = shouldProbeServices
        ? await probeServices(state.plan, targets)
        : [];
      services = processState.map((service) => ({
        ...service,
        healthy:
          service.running &&
          (!shouldProbeServices ||
            probes.find(({ id }) => id === service.id)?.healthy !== false),
      }));
    }
    const journalRevision = await readChangeJournal()
      .then(({ revision }) => String(revision))
      .catch(() => "0");
    return {
      host: "running",
      engine: state.running ? "running" : state.prepared ? "stopped" : "idle",
      generation: state.generation,
      services,
      journalRevision,
      handshake: handshake(),
    };
  }

  private async endpoints() {
    const state = await requiredPreparedState();
    const targets = await this.targets(state);
    const routes = selectedGatewayListeners(state).map((listener) => {
      const target = targets[`${listener.serviceId}:${listener.endpointId}`];
      if (!target) throw runnerError("ENDPOINT_TARGET_MISSING", "Endpoint target is missing.");
      return {
        serviceId: listener.serviceId,
        endpointId: listener.endpointId,
        protocol: "http" as const,
        logicalPort: listener.logicalPort,
        targetHost: target.host,
        targetPort: target.port,
        sandboxPort: listener.sandboxPort,
        basePathMode: listener.basePathMode,
        externallyCompatible: !state.plan!.networking.integratedPreviewRequired,
      };
    });
    return {
      revision: state.endpointRevision,
      primaryEndpointId: routes[0]?.endpointId ?? "",
      routes,
      supportsWebSocket: true,
      integratedPreviewRequired: state.plan!.networking.integratedPreviewRequired,
      incompatibilityReasons: state.plan!.networking.incompatibilityReasons,
    };
  }

  private async logs(cursor?: string, serviceId?: string) {
    const state = await readRuntimeState();
    const serviceIds = serviceId
      ? [serviceId]
      : state.plan?.services.map(({ id }) => id) ?? [];
    if (serviceIds.some((id) => !state.plan?.services.some((service) => service.id === id))) {
      throw runnerError("INVALID_LOG_SERVICE", "Requested log service is not part of the plan.");
    }
    const runtimeState: PreviewSessionState = {
      host: "running",
      engine: state.running ? "running" : "stopped",
      preview: state.running ? "ready" : "closed",
      agent: "idle",
      sync: "clean",
    };
    return processLogEvents({
      sessionId: state.sessionId,
      serviceIds,
      messages: state.engine === "vercel-compose"
        ? await compose.logMessages(serviceIds)
        : undefined,
      cursor,
      serviceId,
      state: runtimeState,
    });
  }

  private async importSource(source: Parameters<typeof importSourceArtifact>[0]) {
    const state = await readRuntimeState();
    if (state.running) throw runnerError("ENGINE_RUNNING", "Stop services before importing source.");
    return importSourceArtifact(source);
  }

  private async exec(request: Extract<RunnerRequest, { operation: "exec" }>) {
    const cwd = await realpath(request.cwd).catch(() => "");
    if (cwd !== runtimePaths.workspace && !cwd.startsWith(`${runtimePaths.workspace}/`)) {
      throw runnerError("WORKSPACE_ACCESS_DENIED", "Command working directory is outside /workspace.");
    }
    if (
      Object.keys(request.environment ?? {}).some((key) =>
        /(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)$/i.test(key)
      )
    ) {
      throw runnerError(
        "RAW_SECRET_REJECTED",
        "Secret-looking command environment values require the credential broker.",
      );
    }
    const result = await executeProjectCommand({ ...request, cwd });
    await checkpointChangeJournal();
    return result;
  }

  private async targets(state: Awaited<ReturnType<typeof requiredPreparedState>>) {
    return state.engine === "vercel-compose" ? compose.targets() : processes.targets(state.plan!);
  }

  private async gatewayRoutes(state: Awaited<ReturnType<typeof requiredPreparedState>>) {
    const targets = await this.targets(state);
    return selectedGatewayListeners(state).map((listener) => {
      const target = targets[`${listener.serviceId}:${listener.endpointId}`];
      if (!target) throw runnerError("ENDPOINT_TARGET_MISSING", "Endpoint target is missing.");
      return {
        sessionId: state.sessionId,
        endpointId: listener.endpointId,
        generation: state.generation,
        logicalPort: listener.logicalPort,
        sandboxPort: listener.sandboxPort,
        targetHost: target.host,
        targetPort: target.port,
      };
    });
  }
}
function selectedGatewayListeners(state: Awaited<ReturnType<typeof requiredPreparedState>>) {
  const selected = state.selection?.serviceIds;
  return selected?.length
    ? state.plan!.networking.gatewayListeners.filter(({ serviceId }) => selected.includes(serviceId))
    : state.plan!.networking.gatewayListeners;
}

function handshake() {
  return runnerHandshake({
    runnerVersion: process.env.BLAME_RUNNER_VERSION ?? "0.1.0",
    imageDigest: process.env.BLAME_RUNNER_IMAGE_DIGEST ?? "standard-runtime-bootstrap",
    capabilities: {
      dockerCompose: true,
      nativeProcesses: true,
      sharedLoopback: true,
      snapshots: true,
      persistentFilesystem: true,
      publicHttpIngress: true,
      webSockets: true,
      networkPolicy: true,
      credentialBroker: false,
      bidirectionalSync: true,
      maxPublishedPorts: 15,
    },
  });
}

async function requiredPreparedState() {
  const state = await readRuntimeState();
  if (!state.prepared || !state.plan || !state.engine) {
    throw runnerError("ENGINE_NOT_PREPARED", "Preview engine is not prepared.");
  }
  return state;
}

function assertExecutionPlan(value: PreviewExecutionPlan) {
  if (
    !value ||
    value.version !== 1 ||
    value.workspaceRoot !== "/workspace" ||
    !Array.isArray(value.services) ||
    !Array.isArray(value.setup) ||
    !Array.isArray(value.probes) ||
    !value.environmentPlan ||
    !value.networking ||
    value.networking.gatewayListeners.length > 15
  ) {
    throw runnerError("INVALID_PLAN", "Preview execution plan is invalid.");
  }
  const ids = new Set<string>();
  for (const service of value.services) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(service.id) || ids.has(service.id)) {
      throw runnerError("INVALID_PLAN", "Preview service ID is invalid or duplicated.");
    }
    ids.add(service.id);
  }
}

async function executeProjectCommand(
  request: Extract<RunnerRequest, { operation: "exec" }>,
) {
  const identity = await projectIdentity();
  return new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("prlimit", [
      "--nproc=512:512",
      "--nofile=4096:4096",
      "--fsize=104857600:104857600",
      "--",
      request.command,
      ...request.args,
    ], {
      cwd: request.cwd,
      env: {
        HOME: "/home/blame-project",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        ...(request.environment ?? {}),
      },
      uid: identity.uid,
      gid: identity.gid,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (current: string, chunk: Buffer) =>
      `${current}${chunk.toString("utf8")}`.slice(-2 * 1024 * 1024);
    child.stdout.on("data", (chunk) => (stdout = append(stdout, chunk)));
    child.stderr.on("data", (chunk) => (stderr = append(stderr, chunk)));
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) signalProcessGroup(child.pid, "SIGKILL");
    }, Math.max(1, Math.min(request.timeoutMs ?? 10 * 60_000, 10 * 60_000)));
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ exitCode: code ?? 1, stdout, stderr, ...(timedOut || signal ? { timedOut } : {}) });
    });
  });
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {}
}

async function projectIdentity() {
  const value = async (flag: string) => {
    const result = await executeSimple("id", [flag, "blame-project"]);
    return Number(result.trim());
  };
  return { uid: await value("-u"), gid: await value("-g") };
}

function executeSimple(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve(output) : reject(new Error(`${command} failed.`))));
  });
}
