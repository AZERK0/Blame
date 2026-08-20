export type DiffStatsValue = {
  additions?: number
  deletions?: number
}

export type UserStoryDiffStats = {
  additions: number
  deletions: number
  files: number
}

export function totalDiffStats(diffs: DiffStatsValue[]): UserStoryDiffStats {
  return diffs.reduce<UserStoryDiffStats>(
    (stats, diff) => ({
      additions: stats.additions + (diff.additions ?? 0),
      deletions: stats.deletions + (diff.deletions ?? 0),
      files: stats.files + 1,
    }),
    { additions: 0, deletions: 0, files: 0 }
  )
}
