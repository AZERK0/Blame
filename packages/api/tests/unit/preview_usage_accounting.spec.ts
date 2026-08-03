import {
  cumulativePeakDelta,
  summarizeCumulativeUsage,
} from '#services/preview_sessions/preview_usage_accounting'
import { test } from '@japa/runner'

test.group('preview usage accounting', () => {
  test('does not bill a cumulative counter regression or its recovery twice', ({ assert }) => {
    assert.equal(Number(cumulativePeakDelta(0.3, 0.2).toFixed(6)), 0.1)
    assert.equal(cumulativePeakDelta(0.19, 0.2), 0)
    assert.equal(cumulativePeakDelta(0.2, 0.2), 0)
  })

  test('sums the peak usage of each sandbox generation', ({ assert }) => {
    const usage = summarizeCumulativeUsage(
      [
        { generation: 1, memoryGbSeconds: 120, cumulativeEstimatedCostUsd: 0.2 },
        { generation: 1, memoryGbSeconds: 110, cumulativeEstimatedCostUsd: 0.19 },
        { generation: 1, memoryGbSeconds: 180, cumulativeEstimatedCostUsd: 0.3 },
        { generation: 2, memoryGbSeconds: 60, cumulativeEstimatedCostUsd: 0.1 },
      ],
      2
    )

    assert.deepEqual(usage, { activeSeconds: 120, estimatedCostUsd: 0.4 })
  })
})
