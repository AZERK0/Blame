import assert from "node:assert/strict"
import test from "node:test"

import { presentBlameHarnessTool } from "./blame-harness-tool-presentation.ts"

test("reuses the file inspection presentation for semantic reads", () => {
  assert.deepEqual(
    presentBlameHarnessTool({
      input: { target: { node_ref: "node://ref" }, view: "body" },
      output: {
        data: { path: "src/domain/order.ts" },
        status: "success",
      },
      toolName: "inspect_code",
    }),
    {
      input: {
        files: [
          {
            entire_file: false,
            path: "src/domain/order.ts",
            read_kind: "node",
            reused: false,
            view: "body",
          },
        ],
      },
      output: {
        data: { path: "src/domain/order.ts" },
        status: "success",
      },
      toolName: "read_files",
    }
  )
})

test("reuses the edited files presentation for transactional changes", () => {
  const presentation = presentBlameHarnessTool({
    input: { action: "apply", operations: [] },
    output: {
      data: {
        proposal: {
          changes: [{ path: "src/edited.ts" }, { path: "src/created.ts" }],
        },
      },
      status: "success",
    },
    toolName: "apply_change",
  })

  assert.equal(presentation.toolName, "apply_patch")
  assert.deepEqual(presentation.input, {
    files: [{ path: "src/edited.ts" }, { path: "src/created.ts" }],
  })
})

test("presents symbolic read coverage and reused content without claiming a full file", () => {
  const presentation = presentBlameHarnessTool({
    input: { target: { symbol_ref: "sym://ref" }, view: "body" },
    output: {
      data: {
        line_range: [20, 34],
        path: "src/order.ts",
        semantic_target: {
          kind: "function",
          qualified_name: "updateOrder",
          type: "symbol",
        },
        status: "already_available",
      },
      status: "success",
    },
    toolName: "inspect_code",
  })

  assert.deepEqual(presentation.input, {
    files: [
      {
        end_line: 34,
        entire_file: false,
        path: "src/order.ts",
        read_kind: "symbol",
        reused: true,
        start_line: 20,
        symbol: "updateOrder",
        symbol_kind: "function",
        view: "body",
      },
    ],
  })
})

test("presents auto-narrowed reads without claiming the requested full range", () => {
  const outline = presentBlameHarnessTool({
    input: { target: { path: "src/large.tsx" }, view: "raw" },
    output: {
      data: {
        auto_narrowed_kind: "semantic_outline",
        content_coverage: "none",
        path: "src/large.tsx",
        requested_range_utf8_bytes: [0, 50_000],
        status: "auto_narrowed",
      },
      status: "success",
    },
    toolName: "inspect_code",
  })
  const preview = presentBlameHarnessTool({
    input: { target: { path: "notes.txt" }, view: "raw" },
    output: {
      data: {
        auto_narrowed_kind: "bounded_preview",
        content_coverage: "partial",
        line_range: [1, 20],
        path: "notes.txt",
        status: "auto_narrowed",
      },
      status: "success",
    },
    toolName: "inspect_code",
  })

  assert.deepEqual(outline.input, {
    files: [
      {
        entire_file: false,
        path: "src/large.tsx",
        read_kind: "outline",
        reused: false,
        view: "raw",
      },
    ],
  })
  assert.deepEqual(preview.input, {
    files: [
      {
        end_line: 20,
        entire_file: false,
        path: "notes.txt",
        read_kind: "bounded_preview",
        reused: false,
        start_line: 1,
        view: "raw",
      },
    ],
  })
})

test("presents suppressed reads without claiming any content coverage", () => {
  const presentation = presentBlameHarnessTool({
    input: { target: { path: "src/large.tsx" }, view: "raw" },
    output: {
      coverage: {
        analysis: "observed_subset",
        scope: "unknown",
        truncated: true,
      },
      data: {
        content_coverage: "none",
        omitted_bytes: 50_000,
        parallel_broad_read_suppressed: true,
        status: "retry_suppressed",
      },
      status: "success",
    },
    toolName: "inspect_code",
  })

  assert.deepEqual(presentation.input, {
    files: [
      {
        entire_file: false,
        parallel_suppressed: true,
        path: "src/large.tsx",
        read_kind: "parallel_suppressed",
        reused: false,
        view: "raw",
      },
    ],
  })
})

test("presents edit_code through the diff surface with validation and rebase state", () => {
  const presentation = presentBlameHarnessTool({
    input: { edits: [] },
    output: {
      data: {
        changed_files: [{ additions: 3, deletions: 1, path: "src/order.ts" }],
        resolution: "automatically_rebased",
        status: "applied",
        validation: { parse: "passed" },
      },
      status: "success",
    },
    toolName: "edit_code",
  })

  assert.equal(presentation.toolName, "apply_patch")
  assert.deepEqual(presentation.input, {
    files: [
      {
        additions: 3,
        deletions: 1,
        path: "src/order.ts",
        resolution: "automatically_rebased",
        validation: "passed",
      },
    ],
  })
})

test("uses operation paths before an apply result is available", () => {
  const presentation = presentBlameHarnessTool({
    input: {
      action: "apply",
      operations: [
        { kind: "text_replace", path: "src/edited.ts" },
        {
          from_path: "src/old.ts",
          kind: "move_file",
          to_path: "src/new.ts",
        },
      ],
    },
    toolName: "apply_change",
  })

  assert.deepEqual(presentation.input, {
    files: [
      { path: "src/edited.ts" },
      { path: "src/old.ts" },
      { path: "src/new.ts" },
    ],
  })
})

test("reuses search result cards for semantic search", () => {
  const presentation = presentBlameHarnessTool({
    input: { query: { kind: "symbol", name: "OrderService" } },
    output: { data: { items: [{ path: "src/order.ts" }] }, status: "success" },
    toolName: "search_code",
  })

  assert.equal(presentation.toolName, "search_codebase")
  assert.deepEqual(presentation.input, { queries: ["symbol: OrderService"] })
  assert.deepEqual(presentation.output, [
    {
      query: "symbol: OrderService",
      result:
        '{\n  "items": [\n    {\n      "path": "src/order.ts"\n    }\n  ]\n}',
      success: true,
    },
  ])
})

test("semantic result cards show paths and symbols without opaque references", () => {
  const presentation = presentBlameHarnessTool({
    input: { query: { kind: "symbol", name: "OrderService" } },
    output: {
      data: {
        items: [
          {
            path: "src/order.ts",
            qualified_name: "OrderService",
            symbol_ref: "s_01",
          },
        ],
      },
      status: "success",
    },
    toolName: "search_code",
  })

  assert.match(JSON.stringify(presentation.output), /src\/order\.ts/u)
  assert.match(JSON.stringify(presentation.output), /OrderService/u)
  assert.doesNotMatch(JSON.stringify(presentation.output), /s_01/u)
})

test("reuses search cards for bounded relation context", () => {
  const presentation = presentBlameHarnessTool({
    input: { target: { symbol_ref: "sym://target" } },
    output: { data: { items: [] }, status: "success" },
    toolName: "get_relation_context",
  })

  assert.equal(presentation.toolName, "search_codebase")
  assert.deepEqual(presentation.input, { queries: ["symbol relations"] })
})

test("reuses terminal cards for task execution and inspection", () => {
  assert.deepEqual(
    presentBlameHarnessTool({
      input: { task: { kind: "test", target: "app" } },
      toolName: "run_task",
    }),
    {
      input: { commands: ["test app"] },
      output: undefined,
      toolName: "run_commands",
    }
  )

  assert.equal(
    presentBlameHarnessTool({
      input: { run_ref: "run://abc", view: "failures" },
      toolName: "inspect_run",
    }).toolName,
    "run_commands"
  )

  assert.deepEqual(
    presentBlameHarnessTool({
      input: { proposal_ref: "change-proposal://abc" },
      toolName: "validate_change",
    }).input,
    { commands: ["validate change"] }
  )
})

test("marks failed task processes as unsuccessful terminal cards", () => {
  const presentation = presentBlameHarnessTool({
    input: { task: { task_id: "test" } },
    output: {
      status: "success",
      data: { status: "failed", outcome: "task_failure" },
    },
    toolName: "run_task",
  })

  assert.deepEqual(presentation.output, [
    {
      query: "test",
      result: '{\n  "status": "failed",\n  "outcome": "task_failure"\n}',
      success: false,
    },
  ])
})

test("leaves unrelated tools unchanged", () => {
  const details = { input: { value: true }, toolName: "custom_tool" }
  assert.strictEqual(presentBlameHarnessTool(details), details)
})
