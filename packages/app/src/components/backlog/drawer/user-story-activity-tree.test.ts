import assert from "node:assert/strict"
import test from "node:test"

import type { UserStoryAgentActivity } from "../data/backlog-data.ts"
import { userStoryActivityTree } from "./user-story-activity-tree.ts"

test("groups consecutive tools from the same parallel group", () => {
  const nodes = userStoryActivityTree([
    activity("reasoning", "reasoning", 1),
    activity("read", "tool", 1, undefined, "group-1"),
    activity("search", "tool", 1, undefined, "group-1"),
    activity("edit", "tool", 2),
  ])

  assert.equal(nodes.length, 3)
  assert.equal(nodes[1]?.type, "group")
  assert.deepEqual(
    nodes[1]?.type === "group"
      ? nodes[1].children.map((child) => child.id)
      : [],
    ["read", "search"]
  )
})

test("keeps same iteration tools flat without a parallel group", () => {
  const nodes = userStoryActivityTree([
    activity("read", "tool", 1, "2026-06-11T10:00:00.000Z"),
    activity("search", "tool", 1, "2026-06-11T10:00:01.000Z"),
  ])

  assert.deepEqual(
    nodes.map((node) => node.type),
    ["activity", "activity"]
  )
})

test("keeps tools without an iteration flat", () => {
  const nodes = userStoryActivityTree([
    activity("read", "tool", undefined, "2026-06-11T10:00:00.000Z"),
    activity("search", "tool", undefined, "2026-06-11T10:00:01.000Z"),
  ])

  assert.deepEqual(
    nodes.map((node) => node.type),
    ["activity", "activity"]
  )
})

test("groups legacy tools started in the same burst", () => {
  const nodes = userStoryActivityTree([
    activity("read", "tool", undefined, "2026-06-11T10:00:00.000Z"),
    activity("search", "tool", undefined, "2026-06-11T10:00:00.041Z"),
  ])

  assert.equal(nodes.length, 1)
  assert.equal(nodes[0]?.type, "group")
})

test("does not group tools separated by another activity", () => {
  const nodes = userStoryActivityTree([
    activity("read", "tool", 1),
    activity("reasoning", "reasoning", 1),
    activity("search", "tool", 1),
  ])

  assert.deepEqual(
    nodes.map((node) => node.type),
    ["activity", "activity", "activity"]
  )
})

function activity(
  id: string,
  kind: UserStoryAgentActivity["kind"],
  iteration?: number,
  createdAt = "2026-06-11T10:00:00.000Z",
  parallelGroupId?: string
): UserStoryAgentActivity {
  return {
    createdAt,
    detail: "",
    id,
    iteration,
    kind,
    parallelGroupId,
    status: "completed",
    title: id,
  }
}
