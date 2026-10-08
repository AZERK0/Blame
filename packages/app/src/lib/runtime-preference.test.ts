import assert from "node:assert/strict"
import test from "node:test"

import {
  pruneRuntimeSessionStates,
  recordRuntimeSessionState,
  runtimeProfileSwitchBlockReason,
  runtimePreferenceForPremium,
} from "./runtime-preference.ts"

class TestStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  removeItem(key: string) {
    this.values.delete(key)
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

let storage: TestStorage

test("uses the local runtime when a saved cloud preference loses Premium access", () => {
  const preference = {
    profile: "vercel-compose" as const,
    source: "account-default" as const,
    confirmedCloudUploadAt: "2026-10-09T10:00:00Z",
  }
  assert.deepEqual(runtimePreferenceForPremium(preference, false), {
    profile: "local-container",
    source: "account-default",
  })
  assert.equal(runtimePreferenceForPremium(preference, true), preference)
  assert.equal(preference.profile, "vercel-compose")
})

test("keeps local runtime preferences independent of Premium", () => {
  const preference = {
    profile: "local-container" as const,
    source: "account-default" as const,
  }
  assert.equal(runtimePreferenceForPremium(preference, false), preference)
  assert.equal(runtimePreferenceForPremium(preference, true), preference)
})

test("retains active cloud preview controls after Premium expires", () => {
  const preference = {
    profile: "vercel-compose" as const,
    source: "account-default" as const,
  }
  assert.equal(runtimePreferenceForPremium(preference, false, true), preference)
  assert.equal(
    runtimePreferenceForPremium(preference, false, false).profile,
    "local-container"
  )
})

test.beforeEach(() => {
  storage = new TestStorage()
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  })
})

test("removes stopped sessions instead of retaining an empty registry", () => {
  recordRuntimeSessionState("story", "vercel-compose", false)
  assert.equal(
    runtimeProfileSwitchBlockReason("local-container"),
    "Stop the active preview before changing runtime profile."
  )

  recordRuntimeSessionState("story", "vercel-compose", true)

  assert.equal(runtimeProfileSwitchBlockReason("local-container"), undefined)
  assert.equal(storage.getItem("blame.runtime-active-sessions.v1"), null)
})

test("prunes sessions belonging to stories that are no longer active", () => {
  recordRuntimeSessionState("active-story", "local-container", false)
  recordRuntimeSessionState("completed-story", "vercel-compose", false)

  pruneRuntimeSessionStates(new Set(["active-story"]))

  assert.equal(runtimeProfileSwitchBlockReason("local-container"), undefined)
  assert.equal(
    runtimeProfileSwitchBlockReason("vercel-compose"),
    "Stop the active preview before changing runtime profile."
  )
})
