import assert from "node:assert/strict"
import test from "node:test"

import {
  isMainWindowRole,
  mainWindowPresentation,
} from "./main-window-presentation.ts"

test("defines a fixed compact window with a distinct initial title", () => {
  assert.deepEqual(mainWindowPresentation("Blame", "compact"), {
    height: 700,
    minHeight: 700,
    minWidth: 900,
    resizable: false,
    title: "Blame - Compact",
    width: 900,
  })
})

test("defines a resizable workspace window", () => {
  assert.deepEqual(mainWindowPresentation("Blame Dev", "workspace"), {
    height: 900,
    minHeight: 640,
    minWidth: 960,
    resizable: true,
    title: "Blame Dev",
    width: 1440,
  })
})

test("accepts only supported main window roles", () => {
  assert.equal(isMainWindowRole("compact"), true)
  assert.equal(isMainWindowRole("workspace"), true)
  assert.equal(isMainWindowRole("welcome"), false)
})
