import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  resolveCapabilities,
  runtimeHandle,
  type EndpointMap,
  type ExecInput,
  type ExecResult,
  type LogRequest,
  type PreviewExecutionPlan,
  type PreviewLogEvent,
  type PreviewRuntimeDriver,
  type ProvisionInput,
  type RuntimeHandle,
  type RuntimeObservation,
  type RuntimeSelection,
} from "@blame/preview-runtime";
import type { ProjectPreviewRuntimeState } from "@blame/agent-runtime";
import { resolveWorkspacePath } from "../../workspace-runtime.ts";

type LocalHandle = {
  kind: "local-container";
  sessionId: string;
  worktree: string;
};

export type LocalRuntimeAdapter = {
  control(input: {
    action: "start" | "stop" | "restart";
    configurationId?: string;
    worktree: string;
  }): Promise<ProjectPreviewRuntimeState>;
  state(worktree: string): Promise<ProjectPreviewRuntimeState>;
  logs(input: {
    service?: string;
    tailLines?: number;
    worktree: string;
  }): Promise<{
    available: boolean;
    service?: string;
    services: string[];
    stdout?: string;
    stderr?: string;
  }>;
};

const defaultAdapter: LocalRuntimeAdapter = {
  control: (input) =>
    import("./legacy-local-preview-adapter").then(({ control }) =>
      control(input),
    ),
  state: (worktree) =>
    import("./legacy-local-preview-adapter").then(({ state }) =>
      state(worktree),
    ),
  logs: (input) =>
    import("./legacy-local-preview-adapter").then(({ logs }) => logs(input)),
};

export class LocalPreviewDriver implements PreviewRuntimeDriver {
  readonly profile = "local-container" as const;
  private readonly worktreeForStory: (userStoryId: string) => Promise<string>;
  private readonly adapter: LocalRuntimeAdapter;

  constructor(
    worktreeForStory: (userStoryId: string) => Promise<string>,
    adapter: LocalRuntimeAdapter = defaultAdapter,
  ) {
    this.worktreeForStory = worktreeForStory;
    this.adapter = adapter;
  }

  async capabilities(plan: PreviewExecutionPlan) {
    return resolveCapabilities(this.profile, plan);
  }

  async provisionHost(input: ProvisionInput) {
    const worktree = resolveWorkspacePath(
      await this.worktreeForStory(input.userStoryId),
    );
    return {
      handle: runtimeHandle({
        kind: "local-container",
        sessionId: input.sessionId,
        worktree,
      } satisfies LocalHandle),
    };
  }

  async connect(worktree: string, sessionId = worktree) {
    return runtimeHandle({
      kind: "local-container",
      sessionId,
      worktree: resolveWorkspacePath(worktree),
    } satisfies LocalHandle);
  }

  runtimeState(handle: RuntimeHandle) {
    return this.adapter.state(localHandle(handle).worktree);
  }

  async resumeHost(_handle: RuntimeHandle) {}

  async syncIn(
    _handle: RuntimeHandle,
    source: import("@blame/preview-runtime").SourceArtifact,
  ) {
    return { sourceRevision: source.revision, workspaceHash: source.sha256 };
  }

  async prepareEngine(_handle: RuntimeHandle, _plan: PreviewExecutionPlan) {}

  async startServices(handle: RuntimeHandle, selection: RuntimeSelection) {
    await this.adapter.control({
      action: "start",
      configurationId: selection.configurationId,
      worktree: localHandle(handle).worktree,
    });
  }

  async stopServices(handle: RuntimeHandle) {
    await this.adapter.control({
      action: "stop",
      worktree: localHandle(handle).worktree,
    });
  }

  exec(handle: RuntimeHandle, input: ExecInput) {
    const root = localHandle(handle).worktree;
    const cwd = resolve(root, input.cwd ?? ".");
    if (cwd !== root && !cwd.startsWith(`${root}/`))
      throw new Error("Command escapes the local worktree");
    return runCommand(cwd, input);
  }

  async inspect(handle: RuntimeHandle): Promise<RuntimeObservation> {
    const value = await this.adapter.state(localHandle(handle).worktree);
    return {
      host: "running",
      engine: value.desiredStatus === "running" ? "running" : "stopped",
      services: value.configurations.map(({ id }) => ({
        id,
        running: value.statuses[id] === "running",
        healthy: value.statuses[id] !== "error",
      })),
    };
  }

  async endpoints(handle: RuntimeHandle): Promise<EndpointMap> {
    const value = await this.adapter.state(localHandle(handle).worktree);
    const url = value.previewUrl ? new URL(value.previewUrl) : undefined;
    const selected = value.configurations.find(
      ({ id }) => id === value.selectedConfigurationId,
    );
    const endpointId = selected?.id ?? "preview";
    const logicalPort = Number(
      url?.port || (url?.protocol === "https:" ? 443 : 80),
    );
    const routes = url
      ? [
          {
            routeId: `${localHandle(handle).sessionId}:${selected?.previewService ?? endpointId}:${endpointId}`,
            serviceId: selected?.previewService ?? endpointId,
            endpointId,
            protocol:
              url.protocol === "https:"
                ? ("https" as const)
                : ("http" as const),
            logicalHost: "localhost" as const,
            logicalPort,
            targetHost: "127.0.0.1",
            targetPort: logicalPort,
            sandboxPort: logicalPort,
            publicUrl: url.toString(),
            basePathMode: "root" as const,
            externallyCompatible: true,
          },
        ]
      : [];
    return {
      revision: 1,
      primaryRouteId: routes[0]?.routeId ?? "",
      primaryPublicUrl: routes[0]?.publicUrl ?? "",
      routes,
      supportsWebSocket: true,
      integratedPreviewRequired: false,
      incompatibilityReasons: [],
    };
  }

  async *logs(input: LogRequest): AsyncIterable<PreviewLogEvent> {
    const handle = localHandle(input.handle);
    const snapshot = await this.adapter.logs({
      service: input.serviceId,
      worktree: handle.worktree,
    });
    if (!snapshot.available || !("service" in snapshot)) return;
    yield {
      sessionId: handle.sessionId,
      sequence: 1,
      timestamp: new Date().toISOString(),
      state: {
        host: "running",
        engine: "running",
        preview: "ready",
        agent: "idle",
        sync: "clean",
      },
      serviceId: snapshot.service,
      stream: "stdout",
      message: `${snapshot.stdout ?? ""}${snapshot.stderr ?? ""}`,
    };
  }

  async exportDelta(_handle: RuntimeHandle, revision: string) {
    return {
      artifactId: `local:${revision}`,
      baseHash: revision,
      finalHash: revision,
      generation: 0,
      revision,
      durableAt: new Date().toISOString(),
    };
  }

  async suspendHost(handle: RuntimeHandle) {
    await this.stopServices(handle);
    return { suspendedAt: new Date().toISOString() };
  }

  async destroyHost(handle: RuntimeHandle) {
    await this.stopServices(handle);
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
}

function localHandle(handle: RuntimeHandle) {
  const value = handle as unknown as LocalHandle;
  if (value.kind !== "local-container" || !value.worktree)
    throw new Error("Invalid local runtime handle");
  return value;
}

function runCommand(cwd: string, input: ExecInput) {
  return new Promise<ExecResult>((resolveResult, reject) => {
    const child = spawn(input.command, input.args ?? [], {
      cwd,
      env: { ...process.env, ...(input.environment ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    const timeout = input.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, input.timeoutMs)
      : undefined;
    child.once("error", reject);
    child.once("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      resolveResult({ exitCode: code ?? 1, stdout, stderr, timedOut });
    });
  });
}
