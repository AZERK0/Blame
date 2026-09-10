import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import type { AgentEvent } from "@blame/agent-runtime";

type StreamEvent = {
  bytes: number;
  data: string;
  sequence: number;
};

type StreamClient = {
  blocked: boolean;
  queue: StreamEvent[];
  response: ServerResponse;
};

type StreamSession = {
  clients: Set<StreamClient>;
  bufferedBytes: number;
  cleanupTimer?: NodeJS.Timeout;
  events: StreamEvent[];
  nextSequence: number;
  token: string;
};

const maximumBufferedEvents = 16_384;
const maximumBufferedBytes = 16 * 1024 * 1024;
const maximumClientQueue = 128;
const completedSessionRetentionMs = 5 * 60_000;

export class AgentEventStream {
  private readonly sessions = new Map<string, StreamSession>();

  beginSession(sessionId: string) {
    this.resetSession(sessionId);
  }

  prepareSession<T extends Record<string, unknown>>(input: T) {
    const sessionId =
      typeof input.sessionId === "string" && input.sessionId.trim()
        ? input.sessionId
        : `${Date.now()}_${randomUUID().replaceAll("-", "").slice(0, 5)}`;
    // Initialize before the runtime can publish an immediate error or result.
    this.beginSession(sessionId);
    return { ...input, sessionId };
  }

  url(sessionId: string, baseUrl: string) {
    const session = this.session(sessionId);
    const url = new URL(
      `/agent/sessions/${encodeURIComponent(sessionId)}/events`,
      baseUrl,
    );
    url.searchParams.set("token", session.token);
    return url.toString();
  }

  publish(event: AgentEvent) {
    if (!event.sessionId) return undefined;
    return this.publishEvent(event);
  }

  flush() {}

  private publishEvent(event: AgentEvent) {
    const sessionId = event.sessionId;
    if (!sessionId) return;
    const session = this.session(sessionId);
    const sequenceNumber = session.nextSequence;
    const transportEvent = {
      ...event,
      createdAt: event.createdAt ?? new Date().toISOString(),
      eventId: event.eventId ?? randomUUID(),
      eventType: event.eventType ?? event.type,
      sequenceNumber,
    };
    const data = JSON.stringify(transportEvent);
    const streamEvent = {
      bytes: Buffer.byteLength(data),
      data,
      sequence: sequenceNumber,
    };
    session.nextSequence += 1;
    session.events.push(streamEvent);
    session.bufferedBytes += streamEvent.bytes;
    trimSessionEvents(session);
    session.clients.forEach((client) => this.write(client, streamEvent));
    if (event.type === "done" || event.type === "error") {
      scheduleSessionCleanup(this.sessions, sessionId, session);
    }
    return transportEvent;
  }

  handle(request: IncomingMessage, response: ServerResponse) {
    if (request.method !== "GET") return false;
    const parsed = eventStreamRequest(request.url);
    if (!parsed) return false;
    const session = this.sessions.get(parsed.sessionId);
    if (!session || parsed.token !== session.token) return false;

    const origin = allowedEventStreamOrigin(request.headers.origin);
    response.writeHead(200, {
      ...(origin
        ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" }
        : {}),
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    const client = { blocked: false, queue: [], response };
    session.clients.add(client);
    response.on("close", () => session.clients.delete(client));
    response.on("drain", () => this.drain(client));
    response.write(": connected\n\n");

    const lastSequence = lastEventSequence(request, parsed.lastEventId);
    session.events
      .filter((event) => event.sequence > lastSequence)
      .forEach((event) => this.write(client, event));
    return true;
  }

  close() {
    this.sessions.forEach((session) => {
      if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
      session.clients.forEach((client) => client.response.end());
    });
    this.sessions.clear();
  }

  private session(sessionId: string) {
    const current = this.sessions.get(sessionId);
    if (current) return current;
    const session: StreamSession = {
      bufferedBytes: 0,
      clients: new Set<StreamClient>(),
      events: [],
      nextSequence: 1,
      token: randomUUID(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private resetSession(sessionId: string) {
    const current = this.sessions.get(sessionId);
    if (current?.cleanupTimer) clearTimeout(current.cleanupTimer);
    current?.clients.forEach((client) => client.response.end());
    const session: StreamSession = {
      bufferedBytes: 0,
      clients: new Set<StreamClient>(),
      events: [],
      nextSequence: 1,
      token: randomUUID(),
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  private write(client: StreamClient, event: StreamEvent) {
    if (client.blocked) {
      client.queue.push(event);
      if (client.queue.length > maximumClientQueue) client.response.end();
      return;
    }
    client.blocked = !client.response.write(streamEventPayload(event));
  }

  private drain(client: StreamClient) {
    client.blocked = false;
    while (!client.blocked && client.queue.length) {
      const event = client.queue.shift();
      if (event) this.write(client, event);
    }
  }
}

function allowedEventStreamOrigin(origin: string | undefined) {
  if (!origin || origin === "null") return origin;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      ? origin
      : undefined;
  } catch {
    return undefined;
  }
}

function trimSessionEvents(session: StreamSession) {
  while (
    session.events.length > 1 &&
    (session.events.length > maximumBufferedEvents ||
      session.bufferedBytes > maximumBufferedBytes)
  ) {
    const removed = session.events.shift();
    if (removed) session.bufferedBytes -= removed.bytes;
  }
}

function scheduleSessionCleanup(
  sessions: Map<string, StreamSession>,
  sessionId: string,
  session: StreamSession,
) {
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
  session.cleanupTimer = setTimeout(() => {
    if (sessions.get(sessionId) !== session) return;
    session.clients.forEach((client) => client.response.end());
    sessions.delete(sessionId);
  }, completedSessionRetentionMs);
  session.cleanupTimer.unref();
}

function eventStreamRequest(requestUrl: string | undefined) {
  if (!requestUrl) return undefined;
  const url = new URL(requestUrl, "http://127.0.0.1");
  const match = url.pathname.match(/^\/agent\/sessions\/([^/]+)\/events$/);
  if (!match?.[1]) return undefined;
  return {
    lastEventId: url.searchParams.get("lastEventId"),
    sessionId: decodeURIComponent(match[1]),
    token: url.searchParams.get("token"),
  };
}

function lastEventSequence(
  request: IncomingMessage,
  requestedLastEventId: string | null,
) {
  const value = request.headers["last-event-id"];
  const headerSequence = eventSequence(Array.isArray(value) ? value[0] : value);
  return Math.max(headerSequence, eventSequence(requestedLastEventId));
}

function eventSequence(value: string | undefined | null) {
  const sequence = Number(value);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
}

function streamEventPayload(event: StreamEvent) {
  return `id: ${event.sequence}\ndata: ${event.data}\n\n`;
}
