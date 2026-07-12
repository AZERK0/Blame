import assert from "node:assert/strict"
import test from "node:test"

import { shouldShowSystemNotification } from "./system-notifications.ts"

test("does not show system notifications while the app is focused", () => {
  assert.equal(shouldShowSystemNotification(true, true), false)
})

test("shows system notifications while the app is not focused", () => {
  assert.equal(shouldShowSystemNotification(true, false), true)
})

test("does not show disabled system notifications", () => {
  assert.equal(shouldShowSystemNotification(false, false), false)
})