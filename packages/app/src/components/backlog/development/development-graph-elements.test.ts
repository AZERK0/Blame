import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDevelopmentGraphElements,
  fileIdFor,
} from "./development-graph-elements.ts"

test("builds compound directory nodes for changed files", () => {
  assert.deepEqual(
    buildDevelopmentGraphElements([
      {
        additions: 4,
        deletions: 1,
        file: "src/components/card.tsx",
        status: "modified",
      },
      { additions: 8, file: "src/index.ts", status: "added" },
    ]),
    [
      {
        data: {
          id: "directory:src",
          label: "src",
          nodeType: "directory",
          path: "src",
        },
        group: "nodes",
      },
      {
        data: {
          id: "directory:src/components",
          label: "components",
          nodeType: "directory",
          parent: "directory:src",
          path: "src/components",
        },
        group: "nodes",
      },
      {
        data: {
          additions: 4,
          deletions: 1,
          id: "file:src/components/card.tsx",
          label: "card.tsx",
          nodeType: "file",
          parent: "directory:src/components",
          path: "src/components/card.tsx",
          status: "modified",
        },
        group: "nodes",
      },
      {
        data: {
          additions: 8,
          id: "file:src/index.ts",
          label: "index.ts",
          nodeType: "file",
          parent: "directory:src",
          path: "src/index.ts",
          status: "added",
        },
        group: "nodes",
      },
    ]
  )
})

test("normalizes file ids", () => {
  assert.equal(fileIdFor("\\src\\index.ts"), "file:src/index.ts")
})
