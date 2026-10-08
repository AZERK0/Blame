import assert from "node:assert/strict";
import test from "node:test";
import { requestUsage, reconcileUsage } from "./light-study-accounting.mjs";

test("cumulative totals are not charged a second time and absent cache stays missing", () => {
  const events = [
    { inputTokens: 100, outputTokens: 10, cost: 0.1, totalInputTokens: 100 },
    {
      inputTokens: 200,
      outputTokens: 20,
      cost: 0.2,
      cacheReadTokens: 20,
      totalInputTokens: 300,
      totalOutputTokens: 30,
      totalCost: 0.3,
    },
  ];
  const result = reconcileUsage(
    {
      inputTokens: 300,
      outputTokens: 30,
      cacheReadTokens: 20,
      cacheWriteTokens: 0,
      cost: 0.3,
    },
    events,
    2,
  );
  assert.equal(result.input, 300);
  assert.equal(result.reconciliation.input.sum, 300);
  assert.equal(result.reconciliation.cost.matches, true);
  assert.equal(result.tokensCostReconciled, true);
  assert.equal(result.complete, false);
  assert.equal(result.reconciliation.cacheRead.sum, null);
  assert.equal(result.perRequest[0].cacheRead, null);
  assert.equal(requestUsage({ totalInputTokens: 100 }).input, null);
});

test("an interrupted unreported iteration remains incomplete even when totals match", () => {
  const event = {
    inputTokens: 10,
    outputTokens: 5,
    reasoningTokens: 4,
    cacheReadTokens: 3,
    cacheWriteTokens: 0,
    cost: 0.1,
  };
  assert.equal(reconcileUsage(event, [event], 2).tokensCostReconciled, false);
  const complete = reconcileUsage(event, [event], 1);
  assert.equal(complete.complete, true);
  assert.equal(complete.input + complete.output, 15);
  assert.equal(complete.reasoning, 4);
});
