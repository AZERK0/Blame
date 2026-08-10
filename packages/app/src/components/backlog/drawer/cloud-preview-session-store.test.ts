import assert from "node:assert/strict"
import test from "node:test"
import type { PreviewSessionView } from "@blame/preview-runtime"

import type { ProjectRunnerPendingOperation } from "../board/project-runner-types.ts"

import {
  cachedCloudPreviewPendingOperation,
  cachedCloudPreviewSession,
  cloudPreviewSessionStorageId,
  publishCloudPreviewPendingOperation,
  publishCloudPreviewSession,
  subscribeCloudPreviewPendingOperation,
  subscribeCloudPreviewSession,
} from "./cloud-preview-session-store.ts"

test("notifies an already-mounted preview when auto-start creates its session", () => {
  const storage = new Map<string, string>()
  const storageId = cloudPreviewSessionStorageId("story", "vercel-compose")
  const received: PreviewSessionView[] = []
  const unsubscribe = subscribeCloudPreviewSession(storageId, (session) => {
    received.push(session)
  })
  const value = {
    id: "preview_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as PreviewSessionView

  publishCloudPreviewSession(
    { setItem: (key, item) => storage.set(key, item) },
    storageId,
    value
  )

  assert.equal(storage.get(storageId), value.id)
  assert.equal(cachedCloudPreviewSession(storageId), value)
  assert.deepEqual(received, [value])
  unsubscribe()
})

test("shares an auto-start pending operation with the mounted preview", () => {
  const storageId = cloudPreviewSessionStorageId("pending", "vercel-compose")
  const received: Array<ProjectRunnerPendingOperation | undefined> = []
  const unsubscribe = subscribeCloudPreviewPendingOperation(
    storageId,
    (operation) => received.push(operation)
  )
  const operation = { action: "start", configurationId: "web" } as const

  publishCloudPreviewPendingOperation(storageId, operation)
  assert.equal(cachedCloudPreviewPendingOperation(storageId), operation)
  publishCloudPreviewPendingOperation(storageId, undefined)

  assert.deepEqual(received, [operation, undefined])
  assert.equal(cachedCloudPreviewPendingOperation(storageId), undefined)
  unsubscribe()
})

test("keeps the displayed Vercel duration monotonic between usage samples", () => {
  const storage = new Map<string, string>()
  const storageId = cloudPreviewSessionStorageId("usage", "vercel-compose")
  const first = usageSession("2026-08-10T10:00:00.000Z", 0)
  const delayed = usageSession("2026-08-10T10:00:02.200Z", 0)

  publishCloudPreviewSession(
    { setItem: (key, item) => storage.set(key, item) },
    storageId,
    first
  )
  const current = publishCloudPreviewSession(
    { setItem: (key, item) => storage.set(key, item) },
    storageId,
    delayed
  )

  assert.equal(current.usage?.activeSeconds, 2)
  assert.equal(cachedCloudPreviewSession(storageId)?.usage?.activeSeconds, 2)
})

function usageSession(observedAt: string, activeSeconds: number) {
  return {
    id: "preview_usageusageusageusageusageusage",
    state: { host: "running" },
    usage: { activeSeconds, estimatedCostUsd: 0, observedAt },
  } as PreviewSessionView
}
