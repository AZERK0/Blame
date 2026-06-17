import assert from "node:assert/strict"
import test from "node:test"
import { markdownPreviewBlocks } from "./markdown-preview-parser.ts"

test("splits markdown preview content into lines and fenced code blocks", () => {
  assert.deepEqual(
    markdownPreviewBlocks(
      ["# Title", "", "```ts", "const value = 1", "```", "- item"].join("\n")
    ),
    [
      { key: "line-0-# Title", line: "# Title", lineIndex: 0, type: "line" },
      { key: "line-1-", line: "", lineIndex: 1, type: "line" },
      { code: "const value = 1", key: "code-2", type: "code" },
      { key: "line-5-- item", line: "- item", lineIndex: 5, type: "line" },
    ]
  )
})
