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
      input: { files: [{ path: "src/domain/order.ts" }] },
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

test("leaves unrelated tools unchanged", () => {
  const details = { input: { value: true }, toolName: "custom_tool" }
  assert.strictEqual(presentBlameHarnessTool(details), details)
})
