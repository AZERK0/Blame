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

test("splits markdown preview content into table blocks", () => {
  assert.deepEqual(
    markdownPreviewBlocks(
      [
        "| Line | Before | After |",
        "|------|--------|-------|",
        '| 388 | label="+ Nouveau projet" | label="Nouveau projet" |',
        '| 421 | label="+ Créer mon premier projet" | label="Créer mon premier projet" |',
      ].join("\n")
    ),
    [
      {
        header: ["Line", "Before", "After"],
        key: "table-0",
        rows: [
          ["388", 'label="+ Nouveau projet"', 'label="Nouveau projet"'],
          [
            "421",
            'label="+ Créer mon premier projet"',
            'label="Créer mon premier projet"',
          ],
        ],
        type: "table",
      },
    ]
  )
})
