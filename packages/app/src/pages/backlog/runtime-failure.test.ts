import assert from "node:assert/strict"
import test from "node:test"
import {
  runtimeFailureDetail,
  runtimeFailureTitle,
  runtimeReportFailure,
} from "./runtime-failure.ts"

test("shows the useful runtime stderr without the Electron IPC prefix", () => {
  const error = new Error(
    "Error invoking remote method 'workspace:ensure-runtime-ready': Error: Command failed: blame-lima-runtime ensure\n\u001b[31mLima could not create the VM\u001b[0m"
  )

  assert.equal(
    runtimeFailureDetail(error),
    "Command failed: blame-lima-runtime ensure\nLima could not create the VM"
  )
})

test("reports a runtime that remains unavailable after setup", () => {
  const failure = runtimeReportFailure({
    issues: [{ action: "Repair the Lima VM and try again." }],
    status: "broken",
  })

  assert.equal(
    failure,
    "Blame Runtime is still broken. Repair the Lima VM and try again."
  )
})

test("does not report a ready runtime as failed", () => {
  assert.equal(runtimeReportFailure({ issues: [], status: "ready" }), null)
})

test("uses an explicit title for each runtime operation", () => {
  assert.equal(runtimeFailureTitle("ensure"), "Runtime setup failed")
  assert.equal(runtimeFailureTitle("repair"), "Runtime repair failed")
  assert.equal(runtimeFailureTitle("reset"), "Runtime reset failed")
})
