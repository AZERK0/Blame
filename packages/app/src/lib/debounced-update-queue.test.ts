import assert from "node:assert/strict"
import test from "node:test"

import { createDebouncedUpdateQueue } from "./debounced-update-queue.ts"

test("coalesces a target without delaying another target", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const queue = createDebouncedUpdateQueue<number>(1500)
  const persisted: [string, number][] = []
  queue.schedule("story", 1, (update) => persisted.push(["story", update]))
  queue.schedule("chat", 2, (update) => persisted.push(["chat", update]))
  context.mock.timers.tick(1000)
  queue.schedule("story", 3, (update) => persisted.push(["story", update]))
  context.mock.timers.tick(500)
  assert.deepEqual(persisted, [["chat", 2]])
  assert.equal(queue.get("story"), 3)
  context.mock.timers.tick(1000)
  assert.deepEqual(persisted, [
    ["chat", 2],
    ["story", 3],
  ])
  assert.equal(queue.get("story"), undefined)
})

test("taking a terminal update cancels its delayed write", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const queue = createDebouncedUpdateQueue<{ sequence: number }>(1500)
  const persist = context.mock.fn()
  queue.schedule("run", { sequence: 42 }, persist)
  assert.deepEqual(queue.take("run"), { sequence: 42 })
  assert.equal(queue.take("run"), undefined)
  context.mock.timers.tick(1500)
  assert.equal(persist.mock.callCount(), 0)
})

test("a stale timer cannot persist or remove a replacement", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  context.mock.method(globalThis, "clearTimeout", () => undefined)
  const queue = createDebouncedUpdateQueue<number>(1500)
  const persisted: number[] = []
  queue.schedule("run", 1, (update) => persisted.push(update))
  context.mock.timers.tick(1000)
  queue.schedule("run", 2, (update) => persisted.push(update))
  context.mock.timers.tick(500)
  assert.deepEqual(persisted, [])
  assert.equal(queue.get("run"), 2)
  context.mock.timers.tick(1000)
  assert.deepEqual(persisted, [2])
})

test("clearing on unmount cancels every target and permits later reuse", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const queue = createDebouncedUpdateQueue<number>(1500)
  const persist = context.mock.fn()
  queue.schedule("story", 1, persist)
  queue.schedule("chat", 2, persist)
  queue.clear()
  context.mock.timers.tick(1500)
  assert.equal(queue.get("story"), undefined)
  assert.equal(persist.mock.callCount(), 0)
  queue.schedule("story", 3, persist)
  context.mock.timers.tick(1500)
  assert.equal(persist.mock.callCount(), 1)
  assert.deepEqual(persist.mock.calls[0].arguments, [3])
})

test("removes the pending entry before persistence and preserves reentrant updates", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] })
  const queue = createDebouncedUpdateQueue<number>(1500)
  const persisted: number[] = []
  queue.schedule("run", 1, (update) => {
    assert.equal(queue.get("run"), undefined)
    persisted.push(update)
    queue.schedule("run", 2, (next) => persisted.push(next))
  })
  context.mock.timers.tick(1500)
  assert.equal(queue.get("run"), 2)
  context.mock.timers.tick(1500)
  assert.deepEqual(persisted, [1, 2])
})
