import assert from "node:assert/strict"
import test from "node:test"

import {
  cloudSession,
  readCloudSession,
  removeCloudSession,
  writeCloudSession,
} from "./cloud-auth-storage.ts"

test("accepts a stored session with a UUID user id", () => {
  assert.deepEqual(
    cloudSession(session("01981221-2b74-7bc0-a1f5-9f9c58f0e050")),
    {
      token: "token",
      user: {
        id: "01981221-2b74-7bc0-a1f5-9f9c58f0e050",
        email: "user@example.com",
        initials: "UC",
        fullName: "User Cloud",
        createdAt: "2026-07-05T10:00:00.000Z",
        updatedAt: "2026-07-05T10:00:00.000Z",
      },
    }
  )
})

test("normalizes a legacy numeric user id", () => {
  assert.equal(cloudSession(session(42))?.user.id, "42")
})

test("ignores invalid stored sessions", () => {
  assert.equal(cloudSession({ token: "token", user: { id: null } }), undefined)
})

test("persists and removes a cloud session", () => {
  const storage = memoryStorage()
  const value = cloudSession(session("01981221-2b74-7bc0-a1f5-9f9c58f0e050"))
  assert.ok(value)

  writeCloudSession(value, storage)
  assert.deepEqual(readCloudSession(storage), value)

  removeCloudSession(storage)
  assert.equal(readCloudSession(storage), undefined)
})

function session(id: string | number) {
  return {
    token: "token",
    user: {
      id,
      email: "user@example.com",
      initials: "UC",
      fullName: "User Cloud",
      createdAt: "2026-07-05T10:00:00.000Z",
      updatedAt: "2026-07-05T10:00:00.000Z",
    },
  }
}

function memoryStorage() {
  const values = new Map<string, string>()

  return {
    getItem(key: string) {
      return values.get(key) ?? null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
  }
}
