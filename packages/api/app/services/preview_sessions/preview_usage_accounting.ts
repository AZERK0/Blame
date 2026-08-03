export type CumulativePreviewUsageSample = {
  generation: number
  memoryGbSeconds: number
  cumulativeEstimatedCostUsd: number
}

export function cumulativePeakDelta(current: number, previousPeak?: number) {
  const normalizedCurrent = nonNegativeFinite(current)
  const normalizedPeak = nonNegativeFinite(previousPeak ?? 0)
  return Math.max(0, normalizedCurrent - normalizedPeak)
}

export function summarizeCumulativeUsage(
  samples: CumulativePreviewUsageSample[],
  memoryGb: number
) {
  const peaks = new Map<number, { memoryGbSeconds: number; estimatedCostUsd: number }>()
  for (const sample of samples) {
    const current = peaks.get(sample.generation) ?? {
      memoryGbSeconds: 0,
      estimatedCostUsd: 0,
    }
    current.memoryGbSeconds = Math.max(
      current.memoryGbSeconds,
      nonNegativeFinite(sample.memoryGbSeconds)
    )
    current.estimatedCostUsd = Math.max(
      current.estimatedCostUsd,
      nonNegativeFinite(sample.cumulativeEstimatedCostUsd)
    )
    peaks.set(sample.generation, current)
  }

  let memoryGbSeconds = 0
  let estimatedCostUsd = 0
  for (const peak of peaks.values()) {
    memoryGbSeconds += peak.memoryGbSeconds
    estimatedCostUsd += peak.estimatedCostUsd
  }

  return {
    activeSeconds: Math.round(memoryGbSeconds / Math.max(1, memoryGb)),
    estimatedCostUsd,
  }
}

function nonNegativeFinite(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 0
}
