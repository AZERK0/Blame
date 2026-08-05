import assert from "node:assert/strict"
import test from "node:test"

import { parseGitHubRepository } from "./github-api.ts"

test("parses HTTPS and SSH GitHub remotes", () => {
  assert.deepEqual(
    parseGitHubRepository("https://github.com/OpenAI/codex.git"),
    {
      name: "codex",
      owner: "OpenAI",
    }
  )
  assert.deepEqual(parseGitHubRepository("ssh://git@github.com/OpenAI/codex"), {
    name: "codex",
    owner: "OpenAI",
  })
})

test("ignores non-GitHub remotes", () => {
  assert.equal(
    parseGitHubRepository("https://gitlab.com/openai/codex"),
    undefined
  )
})
