import assert from "node:assert/strict"
import test from "node:test"

import { managedPreviewStopCommand } from "./managed-preview-control.ts"

test("suspends cloud compute when a preview is stopped", () => {
  assert.deepEqual(managedPreviewStopCommand("stop"), { type: "suspend-host" })
})

test("keeps cloud compute active during an in-place restart", () => {
  assert.deepEqual(managedPreviewStopCommand("restart"), {
    type: "stop-services",
  })
})
