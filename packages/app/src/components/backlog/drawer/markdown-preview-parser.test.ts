import assert from "node:assert/strict"
import test from "node:test"
import { markdownPreviewBlocks } from "./markdown-preview-parser.ts"
import { markdownWysiwygLines } from "./markdown-wysiwyg-parser.ts"

test("splits parsed markdown into lines and fenced code blocks", () => {
  const markdown = [
    "# Title",
    "",
    "```ts",
    "const value = 1",
    "```",
    "- item",
  ].join("\n")
  const blocks = markdownPreviewBlocks(markdown)

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["line", "line", "code", "line"]
  )
  assert.deepEqual(blocks[0], {
    key: "line-0",
    line: {
      kind: "heading-1",
      prefix: "# ",
      segments: [{ source: "Title", type: "text" }],
    },
    lineIndex: 0,
    type: "line",
  })
  assert.deepEqual(blocks[2], {
    code: "const value = 1",
    key: "code-2",
    language: "ts",
    lineIndex: 2,
    type: "code",
  })
  assert.deepEqual(blocks[3], {
    key: "line-5",
    line: markdownWysiwygLines(markdown)[5],
    lineIndex: 5,
    type: "line",
  })
})

test("parses table cells with the shared inline markdown engine", () => {
  const blocks = markdownPreviewBlocks(
    [
      "| File | Result |",
      "|------|--------|",
      "| [editor](packages/editor.tsx) | **shared** |",
    ].join("\n")
  )
  const [table] = blocks

  assert.equal(table.type, "table")
  if (table.type !== "table") return
  assert.deepEqual(
    table.header.map((cell) => cell.source),
    ["File", "Result"]
  )
  assert.deepEqual(table.rows[0][0], {
    segments: [
      {
        content: "editor",
        href: "packages/editor.tsx",
        source: "[editor](packages/editor.tsx)",
        type: "link",
      },
    ],
    source: "[editor](packages/editor.tsx)",
  })
  assert.deepEqual(table.rows[0][1].segments, [
    {
      content: "shared",
      source: "**shared**",
      type: "bold",
    },
  ])
})

test("uses the same parsed lines for nested lists and read-only content", () => {
  const markdown = [
    "## Heading",
    "- parent",
    "  - child",
    "    2. ordered",
    "      - [x] complete",
    "> quote",
  ].join("\n")
  const previewLines = markdownPreviewBlocks(markdown).flatMap((block) =>
    block.type === "line" ? [block.line] : []
  )

  assert.deepEqual(previewLines, markdownWysiwygLines(markdown))
})

test("keeps an unclosed code fence as a code block", () => {
  assert.deepEqual(markdownPreviewBlocks("```ts\nconst value = 1"), [
    {
      code: "const value = 1",
      key: "code-0",
      language: "ts",
      lineIndex: 0,
      type: "code",
    },
  ])
})
