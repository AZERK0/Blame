import {
  agentRpcRequest,
  agentRpcResponseError,
  type AgentHostMethod,
  type AgentRpcResponse,
} from "./agent-runtime-process-protocol.ts";

type PendingHostRequest = {
  abort?: () => void;
  reject(error: Error): void;
  resolve(value: unknown): void;
  signal?: AbortSignal;
};

type AgentHostMessageSender = {
  postMessage(message: unknown): void;
};

export class AgentRuntimeHostClient {
  private readonly pending = new Map<string, PendingHostRequest>();
  private readonly sender: AgentHostMessageSender;

  constructor(sender: AgentHostMessageSender) {
    this.sender = sender;
  }

  request<Result>(
    method: AgentHostMethod,
    input?: unknown,
    signal?: AbortSignal,
  ) {
    const request = agentRpcRequest("host", method, input);
    return new Promise<Result>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const abort = signal ? () => this.abort(request.id) : undefined;
      this.pending.set(request.id, {
        abort,
        reject,
        resolve,
        signal,
      });
      signal?.addEventListener("abort", abort!, { once: true });
      this.sender.postMessage(request);
    });
  }

  resolve(response: AgentRpcResponse) {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.delete(response.id, pending);
    if (response.error) pending.reject(agentRpcResponseError(response.error));
    else pending.resolve(response.result);
  }

  fail(error: Error) {
    for (const [id, pending] of this.pending) {
      this.delete(id, pending);
      pending.reject(error);
    }
  }

  private abort(id: string) {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.delete(id, pending);
    this.sender.postMessage({ id, kind: "cancel", target: "host" });
    pending.reject(abortError());
  }

  private delete(id: string, pending: PendingHostRequest) {
    this.pending.delete(id);
    if (pending.abort) {
      pending.signal?.removeEventListener("abort", pending.abort);
    }
  }
}

function abortError() {
  return new DOMException("Agent host request aborted", "AbortError");
}
