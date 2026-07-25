import type { AgentEvent } from "@blame/agent-runtime";
import { utilityProcess, type UtilityProcess } from "electron";
import { constants as osConstants, setPriority } from "node:os";
import {
  agentRpcError,
  agentRpcRequest,
  agentRpcResponseError,
  isAgentProcessMessage,
  type AgentHostMethod,
  type AgentRpcRequest,
  type AgentRpcResponse,
  type AgentRuntimeMethod,
} from "./agent-runtime-process-protocol.ts";

type PendingRuntimeRequest = {
  reject(error: Error): void;
  resolve(value: unknown): void;
};

export type AgentRuntimeProcessCallbacks = {
  handleHostRequest(
    method: AgentHostMethod,
    input: unknown,
    signal: AbortSignal,
  ): Promise<unknown>;
  onEvent(event: AgentEvent): void;
  onExit(error: Error): void;
};

export type AgentRuntimeProcessOptions = AgentRuntimeProcessCallbacks & {
  environment: NodeJS.ProcessEnv;
  modulePath: string;
};

export type AgentRuntimeProcessLike = {
  readonly alive: boolean;
  request<Result>(method: AgentRuntimeMethod, input?: unknown): Promise<Result>;
  shutdown(): Promise<void>;
};

const readyTimeoutMs = 15_000;
const shutdownTimeoutMs = 2_500;

export class AgentRuntimeProcessClient implements AgentRuntimeProcessLike {
  private readonly hostRequests = new Map<string, AbortController>();
  private readonly pending = new Map<string, PendingRuntimeRequest>();
  private readonly options: AgentRuntimeProcessOptions;
  private readonly process: UtilityProcess;
  private readonly readyPromise: Promise<void>;
  private readyReject?: (error: Error) => void;
  private readyResolve?: () => void;
  private readyTimer?: NodeJS.Timeout;
  private stopping = false;
  alive = true;

  constructor(options: AgentRuntimeProcessOptions) {
    this.options = options;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.process = utilityProcess.fork(options.modulePath, [], {
      env: options.environment,
      serviceName: "Blame Agent Worker",
      stdio: "inherit",
    });
    this.registerEvents();
    this.readyTimer = setTimeout(
      () => this.fail(new Error("Agent worker startup timed out")),
      readyTimeoutMs,
    );
  }

  async request<Result>(method: AgentRuntimeMethod, input?: unknown) {
    await this.readyPromise;
    if (!this.alive) throw new Error("Agent worker is unavailable");
    const request = agentRpcRequest("runtime", method, input);
    return new Promise<Result>((resolve, reject) => {
      this.pending.set(request.id, { reject, resolve });
      this.process.postMessage(request);
    });
  }

  async shutdown() {
    if (!this.alive) return;
    this.stopping = true;
    try {
      await withTimeout(
        this.request("shutdown"),
        shutdownTimeoutMs,
        "Agent worker shutdown timed out",
      );
    } catch {}
    this.process.kill();
  }

  private registerEvents() {
    this.process.on("spawn", () => lowerPriority(this.process.pid));
    this.process.on("message", (message) => this.handleMessage(message));
    this.process.on("exit", (code) => {
      this.fail(new Error(`Agent worker exited with code ${code}`));
    });
    this.process.on("error", (type, location) => {
      this.fail(new Error(`Agent worker ${type} at ${location}`));
    });
  }

  private handleMessage(message: unknown) {
    if (!isAgentProcessMessage(message)) return;
    if (message.kind === "ready") {
      this.markReady();
      return;
    }
    if (message.kind === "event") {
      this.options.onEvent(message.event as AgentEvent);
      return;
    }
    if (message.kind === "response" && message.target === "runtime") {
      this.resolve(message);
      return;
    }
    if (message.kind === "request" && message.target === "host") {
      void this.handleHostRequest(message);
      return;
    }
    if (message.kind === "cancel" && message.target === "host") {
      this.hostRequests.get(message.id)?.abort();
    }
  }

  private async handleHostRequest(request: AgentRpcRequest) {
    const controller = new AbortController();
    this.hostRequests.set(request.id, controller);
    try {
      const result = await this.options.handleHostRequest(
        request.method as AgentHostMethod,
        request.input,
        controller.signal,
      );
      this.respondToHost(request, { result });
    } catch (error) {
      this.respondToHost(request, { error: agentRpcError(error) });
    } finally {
      this.hostRequests.delete(request.id);
    }
  }

  private respondToHost(
    request: AgentRpcRequest,
    result: Pick<AgentRpcResponse, "error" | "result">,
  ) {
    if (!this.alive) return;
    this.process.postMessage({
      ...result,
      id: request.id,
      kind: "response",
      target: "host",
    });
  }

  private resolve(response: AgentRpcResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.error) pending.reject(agentRpcResponseError(response.error));
    else pending.resolve(response.result);
  }

  private markReady() {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = undefined;
    this.readyResolve?.();
    this.readyResolve = undefined;
    this.readyReject = undefined;
  }

  private fail(error: Error) {
    if (!this.alive) return;
    this.alive = false;
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyReject?.(error);
    for (const pending of this.pending.values()) pending.reject(error);
    for (const controller of this.hostRequests.values()) controller.abort();
    this.pending.clear();
    this.hostRequests.clear();
    if (!this.stopping) this.options.onExit(error);
  }
}

function lowerPriority(pid: number | undefined) {
  if (!pid) return;
  try {
    setPriority(pid, osConstants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
}

async function withTimeout<T>(
  promise: Promise<T>,
  duration: number,
  message: string,
) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), duration);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
