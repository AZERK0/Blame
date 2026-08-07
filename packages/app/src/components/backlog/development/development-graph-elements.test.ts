import assert from "node:assert/strict"
import test from "node:test"

import {
  buildDevelopmentGraphElements,
  fileIdFor,
} from "./development-graph-elements.ts"

test("builds linked directory nodes for changed files", () => {
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
          path: "src/components",
        },
        group: "nodes",
      },
      {
        data: {
          id: "edge:directory:src->directory:src/components",
          source: "directory:src",
          target: "directory:src/components",
        },
        group: "edges",
      },
      {
        data: {
          additions: 4,
          deletions: 1,
          id: "file:src/components/card.tsx",
          label: "card.tsx",
          nodeType: "file",
          path: "src/components/card.tsx",
          status: "modified",
        },
        group: "nodes",
      },
      {
        data: {
          id: "edge:directory:src/components->file:src/components/card.tsx",
          source: "directory:src/components",
          target: "file:src/components/card.tsx",
        },
        group: "edges",
      },
      {
        data: {
          additions: 8,
          id: "file:src/index.ts",
          label: "index.ts",
          nodeType: "file",
          path: "src/index.ts",
          status: "added",
        },
        group: "nodes",
      },
      {
        data: {
          id: "edge:directory:src->file:src/index.ts",
          source: "directory:src",
          target: "file:src/index.ts",
        },
        group: "edges",
      },
    ]
  )
})

test("normalizes file ids", () => {
  assert.equal(fileIdFor("\\src\\index.ts"), "file:src/index.ts")
})
