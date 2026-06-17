import assert from "node:assert/strict"
import test from "node:test"
import { diffLines } from "./development-diff-parser.ts"

test("maps unified diff lines to old and new line numbers", () => {
  assert.deepEqual(
    diffLines(
      [
        "diff --git a/app.ts b/app.ts",
        "@@ -3,3 +3,4 @@",
        " context",
        "-removed",
        "+added",
        "+extra",
        " tail",
      ].join("\n")
    ),
    [
      { content: "diff --git a/app.ts b/app.ts" },
      { content: "@@ -3,3 +3,4 @@" },
      { content: " context", oldLineNumber: 3, newLineNumber: 3 },
      { content: "-removed", oldLineNumber: 4 },
      { content: "+added", newLineNumber: 4 },
      { content: "+extra", newLineNumber: 5 },
      { content: " tail", oldLineNumber: 5, newLineNumber: 6 },
    ]
  )
})
