import assert from "node:assert/strict"
import test from "node:test"
import { DesktopAuthCallbackDeliveryQueue } from "./desktop-auth-callback-delivery.ts"

test("keeps a callback pending until its delivery is acknowledged", () => {
  const queue = new DesktopAuthCallbackDeliveryQueue()
  const delivery = queue.enqueue({ code: "a".repeat(32) })

  assert.deepEqual(queue.pending(), delivery)
  assert.equal(queue.acknowledge(delivery.id), true)
  assert.equal(queue.pending(), undefined)
})

test("does not clear a newer callback with an older acknowledgement", () => {
  const queue = new DesktopAuthCallbackDeliveryQueue()
  const olderDelivery = queue.enqueue({ error: "oauth_failed" })
  const newerDelivery = queue.enqueue({ code: "b".repeat(32) })

  assert.equal(queue.acknowledge(olderDelivery.id), false)
  assert.deepEqual(queue.pending(), newerDelivery)
})
