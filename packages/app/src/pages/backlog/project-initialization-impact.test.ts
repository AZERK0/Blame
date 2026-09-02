import assert from "node:assert/strict"
import test from "node:test"

import {
  databaseModeForInitializationRepair,
  parseProjectPreviewRepairCandidate,
  previewRepairCandidateMatchesDiff,
} from "./project-initialization-database.ts"
import type {
  PreviewManifest,
  ProjectInitializationImpactDiagnostics,
} from "@blame/agent-runtime"

test("defaults a database introduced by a story to isolated compose", () => {
  const mode = databaseModeForInitializationRepair(initialization(), {
    ...diagnostics(),
    strategicFilesAfter: {
      "prisma/schema.prisma": 'datasource db { provider = "postgresql" }',
    },
  })

  assert.equal(mode, "compose")
})

test("preserves a legacy configured database as existing", () => {
  const evidence = {
    "prisma/schema.prisma": 'datasource db { provider = "postgresql" }',
  }
  const mode = databaseModeForInitializationRepair(initialization(), {
    ...diagnostics(),
    strategicFilesBefore: evidence,
    strategicFilesAfter: evidence,
  })

  assert.equal(mode, "existing")
})

test("keeps an explicit database choice", () => {
  const mode = databaseModeForInitializationRepair(
    { ...initialization(), databaseMode: "existing" },
    {
      ...diagnostics(),
      strategicFilesAfter: { "prisma/schema.prisma": "postgresql" },
    }
  )

  assert.equal(mode, "existing")
})

test("accepts only complete story-local repair candidates", () => {
  const candidate = parseProjectPreviewRepairCandidate(
    JSON.stringify({
      databaseMode: "compose",
      previewManifest: manifest(),
      reason: "The story introduced PostgreSQL.",
      repairSessionId: "repair-session",
      runConfigurations: [],
      sourceTree: "a".repeat(40),
    })
  )

  assert.equal(candidate?.databaseMode, "compose")
  assert.equal(
    parseProjectPreviewRepairCandidate(
      JSON.stringify({ ...candidate, sourceTree: "invalid" })
    ),
    undefined
  )
})

test("promotes a candidate only when its source tree is final", () => {
  assert.equal(previewRepairCandidateMatchesDiff("\n"), true)
  assert.equal(
    previewRepairCandidateMatchesDiff(
      "diff --git a/package.json b/package.json"
    ),
    false
  )
})

function initialization() {
  return {
    previewManifest: manifest(),
    runConfigurations: [],
    databaseMode: null,
  }
}

function diagnostics(): ProjectInitializationImpactDiagnostics {
  return {
    baseCommit: "before",
    mergeCommit: "after",
    changedFiles: [],
    diffSummary: "",
    relevantDiffs: {},
    currentPreviewManifest: manifest(),
    currentRunConfigurations: [],
    strategicFilesBefore: {},
    strategicFilesAfter: {},
  }
}

function manifest(): PreviewManifest {
  return {
    confidence: "high",
    project: { root: "." },
    setup: [],
    services: [],
    caches: [],
    risks: [],
    probes: [],
  }
}
