import assert from "node:assert/strict"
import test from "node:test"

import { createCachedTaskQueue } from "./cached-task-queue.ts"

test("reuses the same task result for a cached key", async () => {
  const enqueue = createCachedTaskQueue<number>(2)
  let calls = 0
  const task = () => Promise.resolve(++calls)

  const results = await Promise.all([enqueue("run-1", task), enqueue("run-1", task)])

  assert.deepEqual(results, [1, 1])
  assert.equal(calls, 1)
})

test("bounds concurrent tasks", async () => {
  const enqueue = createCachedTaskQueue<number>(2)
  let active = 0
  let peak = 0
  const task = async () => {
    active += 1
    peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active -= 1
    return peak
  }

  await Promise.all(Array.from({ length: 6 }, (_, index) => enqueue(`${index}`, task)))

  assert.equal(peak, 2)
})

test("evicts the least recently used cached task", async () => {
  const enqueue = createCachedTaskQueue<number>(1, 2)
  const calls = new Map<string, number>()
  const load = (key: string) =>
    enqueue(key, async () => {
      const count = (calls.get(key) ?? 0) + 1
      calls.set(key, count)
      return count
    })

  await load("first")
  await load("second")
  await load("first")
  await load("third")
  await load("second")

  assert.equal(calls.get("first"), 1)
  assert.equal(calls.get("second"), 2)
})
