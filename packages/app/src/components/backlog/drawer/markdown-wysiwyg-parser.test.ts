import assert from "node:assert/strict"
import test from "node:test"
import {
  markdownArrowNavigationResult,
  markdownAtomicLinkDeletionResult,
  markdownEmptyListDeletionResult,
  markdownExpandedDeletionSelection,
  markdownInlineActionResult,
  markdownListIndentResult,
  markdownListEnterResult,
  markdownWysiwygLines,
  markdownWysiwygStructureChanged,
  markdownWysiwygStructureKey,
} from "./markdown-wysiwyg-parser.ts"

test("formats complete inline markdown while preserving its raw source", () => {
  const [line] = markdownWysiwygLines("*test*")

  assert.deepEqual(line, {
    kind: "paragraph",
    prefix: "",
    segments: [{ content: "test", source: "*test*", type: "italic" }],
  })
  assert.equal(
    `${line.prefix}${line.segments.map((segment) => segment.source).join("")}`,
    "*test*"
  )
})

test("returns incomplete inline markdown as visible plain text after a marker is removed", () => {
  assert.deepEqual(markdownWysiwygLines("*test"), [
    {
      kind: "paragraph",
      prefix: "",
      segments: [{ source: "*test", type: "text" }],
    },
  ])
})

test("changes the editor key only when rendered markdown structure changes", () => {
  assert.equal(
    markdownWysiwygStructureKey("a"),
    markdownWysiwygStructureKey("ordinary text")
  )
  assert.notEqual(
    markdownWysiwygStructureKey(""),
    markdownWysiwygStructureKey("a")
  )
  assert.notEqual(
    markdownWysiwygStructureKey("ordinary text"),
    markdownWysiwygStructureKey("**bold text**")
  )
  assert.notEqual(
    markdownWysiwygStructureKey("one line"),
    markdownWysiwygStructureKey("one line\nsecond line")
  )
})

test("detects structure changes without treating plain text edits as structural", () => {
  assert.equal(
    markdownWysiwygStructureChanged("ordinary text", "ordinary texts"),
    false
  )
  assert.equal(
    markdownWysiwygStructureChanged("first\nordinary", "first\nupdated"),
    false
  )
  assert.equal(markdownWysiwygStructureChanged("", "a"), false)
  assert.equal(
    markdownWysiwygStructureChanged("ordinary text", "**ordinary text**"),
    true
  )
  assert.equal(
    markdownWysiwygStructureChanged("**ordinary**", "**updated**"),
    false
  )
  assert.equal(
    markdownWysiwygStructureChanged("one line", "one line\nsecond line"),
    true
  )
  assert.equal(
    markdownWysiwygStructureChanged("```\nplain", "```\nplain\n```"),
    true
  )
  assert.equal(
    markdownWysiwygStructureChanged(
      "```\nplain\n```",
      "```\n**still code**\n```"
    ),
    false
  )
})

test("preserves heading and list prefixes in the raw source", () => {
  const lines = markdownWysiwygLines("## Heading\n- **item**\n1. next")

  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, prefix: line.prefix })),
    [
      { kind: "heading-2", prefix: "## " },
      { kind: "unordered-list", prefix: "- " },
      { kind: "ordered-list", prefix: "1. " },
    ]
  )
  assert.equal(
    lines
      .map(
        (line) =>
          `${line.prefix}${line.segments.map((segment) => segment.source).join("")}`
      )
      .join("\n"),
    "## Heading\n- **item**\n1. next"
  )
})

test("continues unordered, ordered, and task lists on Enter", () => {
  assert.deepEqual(markdownListEnterResult("- item", 6), {
    cursor: 9,
    value: "- item\n- ",
  })
  assert.deepEqual(markdownListEnterResult("3. item", 7), {
    cursor: 11,
    value: "3. item\n4. ",
  })
  assert.deepEqual(markdownListEnterResult("- [x] item", 10), {
    cursor: 17,
    value: "- [x] item\n- [ ] ",
  })
})

test("parses and continues nested lists while preserving indentation", () => {
  const lines = markdownWysiwygLines(
    "- item\n  - child\n    1. ordered\n      - [ ] task"
  )
  assert.deepEqual(
    lines.map((line) => ({ kind: line.kind, prefix: line.prefix })),
    [
      { kind: "unordered-list", prefix: "- " },
      { kind: "unordered-list", prefix: "  - " },
      { kind: "ordered-list", prefix: "    1. " },
      { kind: "task", prefix: "      - [ ] " },
    ]
  )
  assert.deepEqual(markdownListEnterResult("- item\n  - child", 16), {
    cursor: 21,
    value: "- item\n  - child\n  - ",
  })
})

test("indents and outdents every supported list type with Tab", () => {
  assert.deepEqual(markdownListIndentResult("- item", 6, false), {
    cursor: 8,
    value: "  - item",
  })
  assert.deepEqual(markdownListIndentResult("  1. item", 9, true), {
    cursor: 7,
    value: "1. item",
  })
  assert.deepEqual(markdownListIndentResult("  - [ ] task", 12, false), {
    cursor: 14,
    value: "    - [ ] task",
  })
  assert.equal(markdownListIndentResult("paragraph", 4, false), undefined)
})

test("exits a list when Enter is pressed on an empty list item", () => {
  assert.deepEqual(markdownListEnterResult("- item\n- ", 9), {
    cursor: 7,
    value: "- item\n",
  })
  assert.deepEqual(markdownListEnterResult("1. item\n2. ", 11), {
    cursor: 8,
    value: "1. item\n",
  })
  assert.deepEqual(markdownListEnterResult("- [ ] item\n- [ ] ", 17), {
    cursor: 11,
    value: "- [ ] item\n",
  })
})

test("inserts empty inline formatting with the cursor between its markers", () => {
  assert.deepEqual(markdownInlineActionResult("Hello ", 6, 6, "bold"), {
    cursor: 8,
    value: "Hello ****",
  })
  assert.deepEqual(markdownInlineActionResult("Hello ", 6, 6, "italic"), {
    cursor: 7,
    value: "Hello **",
  })
  assert.deepEqual(markdownInlineActionResult("Hello ", 6, 6, "code"), {
    cursor: 7,
    value: "Hello ``",
  })
  assert.deepEqual(markdownInlineActionResult("Hello ", 6, 6, "strike"), {
    cursor: 8,
    value: "Hello ~~~~",
  })
  assert.deepEqual(markdownInlineActionResult("Hello ", 6, 6, "link"), {
    cursor: 7,
    value: "Hello []()",
  })
})

test("wraps selected text without adding placeholder content", () => {
  assert.deepEqual(markdownInlineActionResult("Hello test", 6, 10, "bold"), {
    cursor: 12,
    value: "Hello **test**",
  })
})

test("deletes a complete link atomically on Backspace or Delete", () => {
  const value = "Hello [test](test.com) world"
  assert.deepEqual(
    markdownAtomicLinkDeletionResult(value, 22, 22, "Backspace"),
    {
      cursor: 6,
      value: "Hello  world",
    }
  )
  assert.deepEqual(markdownAtomicLinkDeletionResult(value, 6, 6, "Delete"), {
    cursor: 6,
    value: "Hello  world",
  })
  assert.equal(
    markdownAtomicLinkDeletionResult(value, 10, 10, "Backspace"),
    undefined
  )
})

test("removes an empty list marker on Backspace", () => {
  assert.deepEqual(markdownEmptyListDeletionResult("- ", 2), {
    cursor: 0,
    value: "",
  })
  assert.deepEqual(markdownEmptyListDeletionResult("1. ", 3), {
    cursor: 0,
    value: "",
  })
  assert.deepEqual(markdownEmptyListDeletionResult("- [ ] ", 6), {
    cursor: 0,
    value: "",
  })
  assert.equal(markdownEmptyListDeletionResult("- A", 3), undefined)
  assert.deepEqual(markdownEmptyListDeletionResult("# ", 2), {
    cursor: 0,
    value: "",
  })
  assert.deepEqual(markdownEmptyListDeletionResult("> ", 2), {
    cursor: 0,
    value: "",
  })
})

test("moves through styles one source character at a time but skips links", () => {
  assert.equal(markdownArrowNavigationResult("**test**", 0, "ArrowRight"), 1)
  assert.equal(markdownArrowNavigationResult("**test**", 2, "ArrowRight"), 3)
  assert.equal(markdownArrowNavigationResult("**test**", 3, "ArrowLeft"), 2)

  const link = "before [test](test.com) after"
  assert.equal(markdownArrowNavigationResult(link, 7, "ArrowRight"), 23)
  assert.equal(markdownArrowNavigationResult(link, 23, "ArrowLeft"), 7)
  assert.equal(markdownArrowNavigationResult(link, 10, "ArrowRight"), 11)
  assert.equal(markdownArrowNavigationResult(link, 15, "ArrowLeft"), 14)
})

test("expands deletion of visible styled content to its hidden markers", () => {
  assert.deepEqual(markdownExpandedDeletionSelection("**test**", 2, 6), {
    start: 0,
    end: 8,
  })
  assert.deepEqual(markdownExpandedDeletionSelection("before *test*", 8, 12), {
    start: 7,
    end: 13,
  })
  assert.deepEqual(markdownExpandedDeletionSelection("**test**", 2, 8), {
    start: 0,
    end: 8,
  })
  assert.deepEqual(markdownExpandedDeletionSelection("**test**", 0, 6), {
    start: 0,
    end: 8,
  })
  assert.deepEqual(markdownExpandedDeletionSelection("plain", 0, 5), {
    start: 0,
    end: 5,
  })
})
