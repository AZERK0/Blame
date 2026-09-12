import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import type { AgentEvent } from "@blame/agent-runtime";

import { AgentEventStream } from "./agent-event-stream.ts";

class Response extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  writable = true;

  writeHead() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return this.writable;
  }
  end() {
    this.ended = true;
  }
}

function request(url: string, lastEventId?: string) {
  return {
    headers: lastEventId ? { "last-event-id": lastEventId } : {},
    method: "GET",
    url: new URL(url).pathname + new URL(url).search,
  };
}

function event(sessionId: string, text: string): AgentEvent {
  return { payload: { text }, sessionId, type: "text" };
}

test("authenticates streams and replays events after the last event id", () => {
  const stream = new AgentEventStream();
  const url = stream.url("session", "http://127.0.0.1:1234");
  stream.publish(event("session", "one"));
  stream.flush();
  stream.publish(event("session", "two"));
  stream.flush();

  const rejected = new Response();
  assert.equal(
    stream.handle(
      request(url.replace(/token=.*/, "token=wrong")) as never,
      rejected as never,
    ),
    false,
  );

  const response = new Response();
  assert.equal(
    stream.handle(request(url, "1") as never, response as never),
    true,
  );
  assert.match(response.chunks.join(""), /id: 2\ndata: .*two/);
  assert.doesNotMatch(response.chunks.join(""), /one/);
});

test("replays from the resume cursor encoded in the stream URL", () => {
  const stream = new AgentEventStream();
  const url = new URL(stream.url("session", "http://127.0.0.1:1234"));
  stream.publish(event("session", "one"));
  stream.publish(event("session", "two"));
  url.searchParams.set("lastEventId", "1");

  const response = new Response();
  stream.handle(request(url.toString()) as never, response as never);

  assert.match(response.chunks.join(""), /id: 2\ndata: .*two/);
  assert.doesNotMatch(response.chunks.join(""), /one/);
});

test("queues events for a slow client and resumes on drain", () => {
  const stream = new AgentEventStream();
  const url = stream.url("session", "http://127.0.0.1:1234");
  const response = new Response();
  response.writable = false;
  stream.handle(request(url) as never, response as never);

  stream.publish(event("session", "one"));
  stream.flush();
  stream.publish(event("session", "two"));
  stream.flush();
  assert.doesNotMatch(response.chunks.join(""), /two/);

  response.writable = true;
  response.emit("drain");
  assert.match(response.chunks.join(""), /one/);
  assert.match(response.chunks.join(""), /two/);
});

test("starts a fresh history for a reused runtime session", () => {
  const stream = new AgentEventStream();
  const firstUrl = stream.url("session", "http://127.0.0.1:1234");
  stream.publish(event("session", "old execution"));
  stream.flush();
  stream.beginSession("session");
  const nextUrl = stream.url("session", "http://127.0.0.1:1234");

  const staleResponse = new Response();
  assert.equal(
    stream.handle(request(firstUrl) as never, staleResponse as never),
    false,
  );
  const response = new Response();
  stream.handle(request(nextUrl) as never, response as never);
  assert.doesNotMatch(response.chunks.join(""), /old execution/);
});

test("keeps events published before the stream URL is requested", () => {
  const stream = new AgentEventStream();
  stream.beginSession("session");
  stream.publish(event("session", "early event"));
  stream.flush();
  const url = stream.url("session", "http://127.0.0.1:1234");
  const response = new Response();
  stream.handle(request(url) as never, response as never);
  assert.match(response.chunks.join(""), /early event/);
});

test("prepares a session before an immediate runtime failure can be published", async () => {
  const stream = new AgentEventStream();
  try {
    const input = stream.prepareSession({ prompt: "Build the carousel" });
    assert.ok(input.sessionId);
    assert.equal(input.prompt, "Build the carousel");
    const startRuntime = async () => {
      stream.publish({
        sessionId: input.sessionId,
        type: "error",
        payload: { message: "Runtime startup failed" },
      });
      return { sessionId: input.sessionId };
    };
    const session = await startRuntime();
    const url = stream.url(session.sessionId, "http://127.0.0.1:1234");
    const response = new Response();
    stream.handle(request(url) as never, response as never);
    assert.match(response.chunks.join(""), /Runtime startup failed/);
  } finally {
    stream.close();
  }
});

test("preparing a reused session drops old events before receiving new activity", () => {
  const stream = new AgentEventStream();
  try {
    stream.publish(event("session", "old execution"));
    const input = stream.prepareSession({ sessionId: "session" });
    assert.equal(input.sessionId, "session");
    stream.publish(event(input.sessionId, "new activity"));
    const response = new Response();
    const url = stream.url(input.sessionId, "http://127.0.0.1:1234");
    stream.handle(request(url) as never, response as never);
    assert.doesNotMatch(response.chunks.join(""), /old execution/);
    assert.match(response.chunks.join(""), /new activity/);
  } finally {
    stream.close();
  }
});

test("does not reset history when multiple consumers request a URL", () => {
  const stream = new AgentEventStream();
  stream.beginSession("session");
  stream.publish(event("session", "shared event"));
  stream.flush();
  const firstUrl = stream.url("session", "http://127.0.0.1:1234");
  const secondUrl = stream.url("session", "http://127.0.0.1:1234");
  assert.equal(firstUrl, secondUrl);
  const response = new Response();
  stream.handle(request(secondUrl) as never, response as never);
  assert.match(response.chunks.join(""), /shared event/);
});

test("resumed feedback survives the previous execution's cleanup deadline", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = new AgentEventStream();
  try {
    stream.publish({ sessionId: "conversation", type: "done", payload: {} });
    const previousUrl = stream.url("conversation", "http://127.0.0.1:1234");
    context.mock.timers.tick(2 * 60_000);

    const input = stream.prepareSession({
      resumeSessionId: " conversation ",
      sessionId: "ipc-placeholder",
    });
    assert.equal(input.sessionId, "conversation");
    const url = stream.url(input.sessionId, "http://127.0.0.1:1234");
    assert.notEqual(url, previousUrl);
    const response = new Response();
    assert.equal(stream.handle(request(url) as never, response as never), true);
    stream.publish(event(input.sessionId, "reading file"));

    context.mock.timers.tick(6 * 60_000);
    assert.equal(response.ended, false);
    const done = stream.publish({
      sessionId: input.sessionId,
      type: "done",
      payload: { text: "Feedback implemented" },
    });
    assert.equal(done?.sequenceNumber, 2);
    assert.match(response.chunks.join(""), /Feedback implemented/);
    const reconnected = new Response();
    assert.equal(
      stream.handle(request(url, "1") as never, reconnected as never),
      true,
    );
    assert.match(reconnected.chunks.join(""), /Feedback implemented/);
  } finally {
    stream.close();
  }
});

test("blank resume ids preserve the requested session identity", () => {
  const stream = new AgentEventStream();
  try {
    assert.equal(
      stream.prepareSession({ resumeSessionId: " ", sessionId: "requested" })
        .sessionId,
      "requested",
    );
  } finally {
    stream.close();
  }
});

test("preserves adjacent native streaming deltas", () => {
  const stream = new AgentEventStream();
  const url = stream.url("session", "http://127.0.0.1:1234");
  const response = new Response();
  stream.handle(request(url) as never, response as never);

  stream.publish(event("session", "one"));
  stream.publish(event("session", "two"));
  stream.flush();

  const payload = response.chunks.join("");
  assert.equal(payload.match(/^data:/gm)?.length, 2);
  assert.match(payload, /"text":"one"/);
  assert.match(payload, /"text":"two"/);
  assert.match(payload, /"sequenceNumber":1/);
  assert.match(payload, /"sequenceNumber":2/);
  assert.match(payload, /"eventType":"text"/);
  assert.match(payload, /"eventId":"[^"]+"/);
});
