import assert from "node:assert/strict";
import test from "node:test";
import { HubRuntimeHost } from "@cline/sdk";

type HubEvent = {
  event: string;
  sessionId: string;
  sequence: number;
  payload: Record<string, unknown>;
};

type Frame = {
  kind: string;
  sessionId?: string;
  sinceSequence?: number;
};

function fixture() {
  const host = new HubRuntimeHost({ url: "ws://127.0.0.1:1/hub" });
  const runtime = host as unknown as {
    client: {
      socket: {
        readyState: number;
        send: (raw: string) => void;
        close: () => void;
      };
      handleFrame: (frame: { kind: string; envelope: HubEvent }) => void;
      command: (name: string, payload?: unknown) => Promise<unknown>;
    };
    registerPlannedSession: (
      id: string,
      capabilities: object,
      handlers: Map<string, unknown>,
    ) => void;
    ensureSessionSubscription: (id: string) => void;
    disposeSessionSubscription: (id: string) => void;
  };
  const frames: Frame[] = [];
  const commands: { name: string; payload: unknown }[] = [];
  const history: HubEvent[] = [];
  const received: string[] = [];
  let subscribed = false;
  runtime.client.socket = {
    readyState: 1,
    close() {},
    send(raw) {
      const frame = JSON.parse(raw) as Frame;
      frames.push(frame);
      if (frame.kind === "stream.unsubscribe") subscribed = false;
      if (frame.kind !== "stream.subscribe") return;
      subscribed = true;
      // Match the hub protocol: omitted cursor subscribes only to live events.
      if (frame.sinceSequence !== undefined) {
        for (const event of history.filter(
          (event) => event.sequence > frame.sinceSequence!,
        )) {
          runtime.client.handleFrame({ kind: "event", envelope: event });
        }
      }
    },
  };
  runtime.client.command = async (name, payload) => {
    commands.push({ name, payload });
    return { ok: true, payload: {} };
  };
  host.subscribe((event: { type: string }) => received.push(event.type));
  function publish(
    event: string,
    sequence: number,
    payload: Record<string, unknown> = {},
  ) {
    const envelope = { event, sessionId: "session", sequence, payload };
    history.push(envelope);
    if (subscribed) runtime.client.handleFrame({ kind: "event", envelope });
  }
  return { host, runtime, frames, commands, received, publish };
}

test("resuming a completed session skips the old terminal event and answers startup capabilities", async () => {
  const f = fixture();
  try {
    f.runtime.registerPlannedSession("session", {}, new Map());
    f.publish("agent.done", 1055, { reason: "completed" });
    await f.host.stopSession("session");
    f.publish("run.completed", 1059, { reason: "completed" });
    f.received.length = 0;

    f.runtime.registerPlannedSession(
      "session",
      {},
      new Map([
        [
          "user_instructions.snapshot",
          async () => ({ instructions: "project instructions" }),
        ],
      ]),
    );
    assert.equal(f.frames.at(-1)?.sinceSequence, undefined);
    assert.equal(
      f.received.length,
      0,
      "the previous run must not finish the new execution",
    );

    f.publish("capability.requested", 1061, {
      requestId: "startup-instructions",
      capabilityName: "user_instructions.snapshot",
      payload: {},
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(
      f.commands.some(
        ({ name, payload }) =>
          name === "capability.respond" && (payload as { ok: boolean }).ok,
      ),
    );

    f.publish("run.started", 1062);
    f.publish("run.completed", 1063, { reason: "completed" });
    assert.ok(
      f.received.includes("ended"),
      "the new run must still deliver its terminal event",
    );
  } finally {
    await f.host.dispose();
  }
});

test("reattaching to an existing execution still replays missed events", async () => {
  const f = fixture();
  try {
    f.runtime.registerPlannedSession("session", {}, new Map());
    f.publish("run.started", 20);
    f.runtime.disposeSessionSubscription("session");
    f.publish("run.completed", 21, { reason: "completed" });
    f.received.length = 0;
    f.runtime.ensureSessionSubscription("session");
    assert.equal(f.frames.at(-1)?.sinceSequence, 20);
    assert.ok(f.received.includes("ended"));
  } finally {
    await f.host.dispose();
  }
});
