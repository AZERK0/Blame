import assert from "node:assert/strict"
import test from "node:test"

import { searchDevelopmentFiles } from "./development-file-search.ts"

const files = [
  {
    name: "development-file-tree.tsx",
    path: "src/components/development-file-tree.tsx",
  },
  {
    name: "development-review.tsx",
    path: "src/components/development-review.tsx",
  },
  { name: "terminal-ipc.ts", path: "src/main/terminal-ipc.ts" },
]

test("ranks fuzzy file matches by the file name", () => {
  assert.deepEqual(
    searchDevelopmentFiles(files, "filetree").map((file) => file.path),
    ["src/components/development-file-tree.tsx"]
  )
})

test("matches paths and keeps an empty query unfiltered", () => {
  assert.deepEqual(searchDevelopmentFiles(files, "main/terminal"), [files[2]])
  assert.deepEqual(searchDevelopmentFiles(files, "  "), files)
})
