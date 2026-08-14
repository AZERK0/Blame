import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntimeHostClient } from "./agent-runtime-host-client.ts";
import type {
  AgentRpcRequest,
  AgentRpcResponse,
} from "./agent-runtime-process-protocol.ts";

test("resolves a host RPC response", async () => {
  const sender = new FakeSender();
  const client = new AgentRuntimeHostClient(sender);
  const result = client.request<string>("git", {
    args: ["status"],
    cwd: "/workspace",
  });
  const request = sender.messages[0] as AgentRpcRequest;

  client.resolve(response(request, "clean"));

  assert.equal(await result, "clean");
});

test("forwards host RPC errors", async () => {
  const sender = new FakeSender();
  const client = new AgentRuntimeHostClient(sender);
  const result = client.request("previewDevtools");
  const request = sender.messages[0] as AgentRpcRequest;

  client.resolve({
    error: { message: "preview unavailable", name: "Error" },
    id: request.id,
    kind: "response",
    target: "host",
  });

  await assert.rejects(result, /preview unavailable/);
});

test("cancels an aborted host RPC request", async () => {
  const sender = new FakeSender();
  const client = new AgentRuntimeHostClient(sender);
  const controller = new AbortController();
  const result = client.request("previewContainerLogs", {}, controller.signal);
  const request = sender.messages[0] as AgentRpcRequest;

  controller.abort();

  await assert.rejects(result, { name: "AbortError" });
  assert.deepEqual(sender.messages[1], {
    id: request.id,
    kind: "cancel",
    target: "host",
  });
});

class FakeSender {
  readonly messages: unknown[] = [];

  postMessage(message: unknown) {
    this.messages.push(message);
  }
}

function response(request: AgentRpcRequest, result: unknown): AgentRpcResponse {
  return {
    id: request.id,
    kind: "response",
    result,
    target: "host",
  };
}
