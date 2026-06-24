import test from "node:test"
import assert from "node:assert/strict"

import type { UserStory } from "./backlog-data.ts"
import {
  changedFilesFromDiff,
  completedStoryContextMarkdown,
} from "./user-story-context.ts"

test("builds completed story context with stable sections", () => {
  const markdown = completedStoryContextMarkdown(story(), ["src/app.ts"])

  assert.match(markdown, /# Context from completed User Story #42/)
  assert.match(markdown, /## Original request\nOriginal summary/)
  assert.match(markdown, /## Session summary\nSession completed./)
  assert.match(markdown, /## Final agent response\nImplemented the feature./)
  assert.match(markdown, /Merge commit: def456/)
  assert.match(markdown, /Files changed:\n- src\/app\.ts/)
})

test("keeps unavailable completed story context sections explicit", () => {
  const markdown = completedStoryContextMarkdown({
    ...story(),
    agentFinalResponse: null,
    agentSessionSummary: null,
    summary: "",
  })

  assert.match(markdown, /## Original request\nNot available./)
  assert.match(markdown, /## Session summary\nNot available./)
  assert.match(markdown, /## Final agent response\nNot available./)
  assert.match(markdown, /Files changed: Not available./)
})

test("cleans absolute worktree paths from context text", () => {
  const worktree =
    "/home/azerko/.local/share/blame/runtime/worktrees/AmazonScrapper/story-473-roadmap-persistance"
  const markdown = completedStoryContextMarkdown(
    {
      ...story(),
      agentFinalResponse: [
        "Updated `/home/azerko/.local/share/blame/runtime/worktrees/AmazonScrapper/story-473-roadmap-persistance/apps/frontend/app/pages/app/roadmap.vue`.",
        "Checked /tmp/outside.log.",
      ].join("\n"),
      agentSessionSummary:
        "Files touched or inspected: /home/azerko/.local/share/blame/runtime/worktrees/AmazonScrapper/story-473-roadmap-persistance/apps/backend/app/models/project.ts, /tmp/outside.log.",
      worktree,
    },
    ["apps/frontend/app/pages/app/roadmap.vue"]
  )

  assert.match(
    markdown,
    /Updated `apps\/frontend\/app\/pages\/app\/roadmap.vue`./
  )
  assert.match(
    markdown,
    /apps\/backend\/app\/models\/project.ts, \/tmp\/outside.log./
  )
  assert.doesNotMatch(markdown, /runtime\/worktrees/)
})

test("extracts changed files from git diff", () => {
  const files = changedFilesFromDiff(
    [
      "diff --git a/src/old.ts b/src/new.ts",
      "index 123..456 100644",
      "diff --git a/package.json b/package.json",
    ].join("\n")
  )

  assert.deepEqual(files, ["src/new.ts", "package.json"])
})

function story(): UserStory {
  return {
    agentFinalResponse: "Implemented the feature.",
    agentSessionSummary: "Session completed.",
    baseCommit: "abc123",
    branch: "story/feature",
    createdAt: "2026-06-24T00:00:00.000Z",
    id: 42,
    mergeCommit: "def456",
    mergedAt: "2026-06-24T01:00:00.000Z",
    owner: "Product",
    priority: "Medium",
    projectId: "project",
    status: "done",
    summary: "Original summary",
    title: "Finished feature",
  }
}
