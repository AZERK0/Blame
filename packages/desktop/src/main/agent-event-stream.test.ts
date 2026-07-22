import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import test from "node:test"

import type { AgentEvent } from "@blame/agent-runtime"

import { AgentEventStream } from "./agent-event-stream.ts"

class Response extends EventEmitter {
  chunks: string[] = []
  ended = false
  writable = true

  writeHead() {}
  write(chunk: string) {
    this.chunks.push(chunk)
    return this.writable
  }
  end() {
    this.ended = true
  }
}

function request(url: string, lastEventId?: string) {
  return {
    headers: lastEventId ? { "last-event-id": lastEventId } : {},
    method: "GET",
    url: new URL(url).pathname + new URL(url).search,
  }
}

function event(sessionId: string, text: string): AgentEvent {
  return { payload: { text }, sessionId, type: "text" }
}

test("authenticates streams and replays events after the last event id", () => {
  const stream = new AgentEventStream()
  const url = stream.url("session", "http://127.0.0.1:1234")
  stream.publish(event("session", "one"))
  stream.publish(event("session", "two"))

  const rejected = new Response()
  assert.equal(
    stream.handle(request(url.replace(/token=.*/, "token=wrong")) as never, rejected as never),
    false
  )

  const response = new Response()
  assert.equal(stream.handle(request(url, "1") as never, response as never), true)
  assert.match(response.chunks.join(""), /id: 2\ndata: .*two/)
  assert.doesNotMatch(response.chunks.join(""), /one/)
})

test("queues events for a slow client and resumes on drain", () => {
  const stream = new AgentEventStream()
  const url = stream.url("session", "http://127.0.0.1:1234")
  const response = new Response()
  response.writable = false
  stream.handle(request(url) as never, response as never)

  stream.publish(event("session", "one"))
  stream.publish(event("session", "two"))
  assert.doesNotMatch(response.chunks.join(""), /two/)

  response.writable = true
  response.emit("drain")
  assert.match(response.chunks.join(""), /one/)
  assert.match(response.chunks.join(""), /two/)
})

test("starts a fresh history for a reused runtime session", () => {
  const stream = new AgentEventStream()
  const firstUrl = stream.url("session", "http://127.0.0.1:1234")
  stream.publish(event("session", "old execution"))
  stream.beginSession("session")
  const nextUrl = stream.url("session", "http://127.0.0.1:1234")

  const staleResponse = new Response()
  assert.equal(
    stream.handle(request(firstUrl) as never, staleResponse as never),
    false
  )
  const response = new Response()
  stream.handle(request(nextUrl) as never, response as never)
  assert.doesNotMatch(response.chunks.join(""), /old execution/)
})

test("keeps events published before the stream URL is requested", () => {
  const stream = new AgentEventStream()
  stream.beginSession("session")
  stream.publish(event("session", "early event"))
  const url = stream.url("session", "http://127.0.0.1:1234")
  const response = new Response()
  stream.handle(request(url) as never, response as never)
  assert.match(response.chunks.join(""), /early event/)
})

test("does not reset history when multiple consumers request a URL", () => {
  const stream = new AgentEventStream()
  stream.beginSession("session")
  stream.publish(event("session", "shared event"))
  const firstUrl = stream.url("session", "http://127.0.0.1:1234")
  const secondUrl = stream.url("session", "http://127.0.0.1:1234")
  assert.equal(firstUrl, secondUrl)
  const response = new Response()
  stream.handle(request(secondUrl) as never, response as never)
  assert.match(response.chunks.join(""), /shared event/)
})