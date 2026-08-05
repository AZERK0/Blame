import assert from "node:assert/strict"
import test from "node:test"
import { diffLines, parseGitDiff } from "./development-diff-parser.ts"

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

test("uses Pierre metadata when parsing Git diff files", () => {
  const patch = [
    "diff --git a/src/app.ts b/src/app.ts",
    "index 123..456 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -3,2 +3,3 @@",
    " context",
    "-removed",
    "+added",
    "+extra",
  ].join("\n")

  assert.deepEqual(parseGitDiff(patch), [
    {
      additions: 2,
      deletions: 1,
      file: "src/app.ts",
      patch,
      status: "modified",
    },
  ])
})

test("ignores Blame-managed files when parsing Git diff files", () => {
  const patch = [
    "diff --git a/.blame/log.txt b/.blame/log.txt",
    "index 123..456 100644",
    "--- a/.blame/log.txt",
    "+++ b/.blame/log.txt",
    "@@ -1 +1 @@",
    "-old",
    "+new",
    "diff --git a/src/app.ts b/src/app.ts",
    "index 123..456 100644",
    "--- a/src/app.ts",
    "+++ b/src/app.ts",
    "@@ -1 +1 @@",
    "-old",
    "+new",
  ].join("\n")

  assert.deepEqual(parseGitDiff(patch).map((diff) => diff.file), ["src/app.ts"])
})
