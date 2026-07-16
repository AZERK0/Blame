import assert from "node:assert/strict"
import test from "node:test"

import { effectiveProjectCodePractices } from "./project-code-practice-preferences.ts"

test("uses non-blocking defaults until code practices are ready", () => {
  assert.deepEqual(effectiveProjectCodePractices([]), [
    { practice: "coding_style", enabled: true },
    { practice: "unit_tests", enabled: false },
    { practice: "layered_architecture", enabled: false },
    { practice: "commit_message_convention", enabled: false },
  ])
})

test("preserves stored code practice choices", () => {
  const practices = effectiveProjectCodePractices([
    { practice: "unit_tests", enabled: true },
  ])

  assert.equal(
    practices.find(({ practice }) => practice === "unit_tests")?.enabled,
    true
  )
  assert.equal(
    practices.find(({ practice }) => practice === "coding_style")?.enabled,
    true
  )
})
