import assert from "node:assert/strict"
import test from "node:test"

import { formatArguments, parseArguments } from "./mcp-arguments.ts"

test("parses quoted and escaped MCP arguments", () => {
  assert.deepEqual(
    parseArguments('-y @dokploy/mcp --label "Dokploy production" empty=""'),
    ["-y", "@dokploy/mcp", "--label", "Dokploy production", "empty="]
  )
})

test("formats MCP arguments without losing spaces, quotes, or empty values", () => {
  const values = ["-y", "@dokploy/mcp", "two words", 'say "hello"', ""]
  assert.deepEqual(parseArguments(formatArguments(values)), values)
})

test("rejects an unclosed quoted MCP argument", () => {
  assert.throws(
    () => parseArguments('"unfinished'),
    /Close the quoted MCP argument/
  )
})
